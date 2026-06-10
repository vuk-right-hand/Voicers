"""
Clipboard change watcher using Win32 AddClipboardFormatListener.

Runs a hidden window in a background thread that receives WM_CLIPBOARDUPDATE
messages from the OS. Zero CPU when clipboard isn't changing — no polling.

Usage:
    watcher = ClipboardWatcher(callback=lambda text: print(text))
    watcher.start()   # spawns daemon thread
    ...
    watcher.stop()    # tears down window + thread
"""

import ctypes
import ctypes.wintypes
import logging
import threading

import pyperclip

logger = logging.getLogger(__name__)

# Win32 constants
WM_CLIPBOARDUPDATE = 0x031D
WM_DESTROY = 0x0002
WM_USER_STOP = 0x0400 + 1  # custom message to break the loop

user32 = ctypes.windll.user32
kernel32 = ctypes.windll.kernel32

WNDPROC = ctypes.WINFUNCTYPE(
    ctypes.c_long,
    ctypes.wintypes.HWND,
    ctypes.c_uint,
    ctypes.wintypes.WPARAM,
    ctypes.wintypes.LPARAM,
)

# ctypes.wintypes.WNDCLASSW is absent in bundled/embedded Python distributions.
# Define the struct directly so it works in both system and bundled Python.
class _WNDCLASSW(ctypes.Structure):
    _fields_ = [
        ("style",         ctypes.c_uint),
        ("lpfnWndProc",   WNDPROC),
        ("cbClsExtra",    ctypes.c_int),
        ("cbWndExtra",    ctypes.c_int),
        ("hInstance",     ctypes.wintypes.HANDLE),
        ("hIcon",         ctypes.wintypes.HANDLE),
        ("hCursor",       ctypes.wintypes.HANDLE),
        ("hbrBackground", ctypes.wintypes.HANDLE),
        ("lpszMenuName",  ctypes.c_wchar_p),
        ("lpszClassName", ctypes.c_wchar_p),
    ]


# ── Process-lifetime window class ───────────────────────────────────────────
# Win32 window classes live for the process lifetime and hold a raw pointer to
# the WNDPROC thunk. Both must therefore be module-level singletons:
#  - re-registering on every start() fails with ERROR_CLASS_ALREADY_EXISTS
#    (which used to kill the watcher on every reconnect after the first), and
#  - a per-run WNDPROC local gets GC'd when _run returns, leaving the class
#    with a dangling function pointer for the next window it backs.

_CLASS_NAME = "VoicerClipboardWatcher"
_active_watcher: "ClipboardWatcher | None" = None


def _static_wnd_proc(hwnd, msg, wparam, lparam):
    watcher = _active_watcher
    if msg == WM_CLIPBOARDUPDATE:
        if watcher is not None:
            watcher._on_clipboard_change()
        return 0
    if msg == WM_DESTROY:
        return 0
    return user32.DefWindowProcW(hwnd, msg, wparam, lparam)


# Keep a module-level reference so the thunk the OS points at is never GC'd.
_WND_PROC_THUNK = WNDPROC(_static_wnd_proc)
_class_registered = False


def _ensure_class_registered() -> bool:
    global _class_registered
    if _class_registered:
        return True
    wc = _WNDCLASSW()
    wc.lpfnWndProc = _WND_PROC_THUNK
    wc.hInstance = kernel32.GetModuleHandleW(None)
    wc.lpszClassName = _CLASS_NAME
    if not user32.RegisterClassW(ctypes.byref(wc)):
        return False
    _class_registered = True
    return True


class ClipboardWatcher:
    """Watches for clipboard changes via Win32 messages and fires a callback."""

    def __init__(self, callback):
        """
        Args:
            callback: Called with (text: str) when clipboard text changes.
                      Only fires for non-empty text that differs from previous.
        """
        self._callback = callback
        self._thread: threading.Thread | None = None
        self._hwnd = None
        self._last_text = ""
        self._running = False

    def start(self):
        """Spawn the watcher thread. Safe to call multiple times (no-ops if running)."""
        if self._running:
            return
        self._running = True
        self._last_text = ""
        try:
            self._last_text = pyperclip.paste() or ""
        except Exception:
            pass
        self._thread = threading.Thread(target=self._run, daemon=True, name="clipboard-watcher")
        self._thread.start()

    def stop(self):
        """Stop the watcher and clean up."""
        self._running = False
        if self._hwnd:
            user32.PostMessageW(self._hwnd, WM_USER_STOP, 0, 0)
        if self._thread:
            self._thread.join(timeout=2)
            self._thread = None

    def _run(self):
        """Thread entry: create hidden window, register listener, pump messages."""
        global _active_watcher

        if not _ensure_class_registered():
            logger.error("Failed to register window class for clipboard watcher")
            return

        _active_watcher = self
        self._hwnd = user32.CreateWindowExW(
            0, _CLASS_NAME, "VoicerClipboard", 0,
            0, 0, 0, 0,
            None, None, kernel32.GetModuleHandleW(None), None,
        )
        if not self._hwnd:
            logger.error("Failed to create hidden window for clipboard watcher")
            return

        if not user32.AddClipboardFormatListener(self._hwnd):
            logger.error("AddClipboardFormatListener failed")
            user32.DestroyWindow(self._hwnd)
            return

        logger.info("Clipboard watcher started")

        # Message pump
        msg = ctypes.wintypes.MSG()
        while self._running:
            ret = user32.GetMessageW(ctypes.byref(msg), None, 0, 0)
            if ret <= 0:
                break
            if msg.message == WM_USER_STOP:
                break
            user32.TranslateMessage(ctypes.byref(msg))
            user32.DispatchMessageW(ctypes.byref(msg))

        # Cleanup
        user32.RemoveClipboardFormatListener(self._hwnd)
        user32.DestroyWindow(self._hwnd)
        self._hwnd = None
        if _active_watcher is self:
            _active_watcher = None
        logger.info("Clipboard watcher stopped")

    def _on_clipboard_change(self):
        """Read clipboard and fire callback if text changed."""
        try:
            text = pyperclip.paste() or ""
        except Exception:
            return

        if text and text != self._last_text:
            self._last_text = text
            try:
                self._callback(text)
            except Exception:
                logger.exception("Clipboard callback error")

    def update_last_text(self, text: str):
        """Update the internal tracker so our own writes don't echo back.

        Call this BEFORE writing to the clipboard (e.g. type_text_paste)
        so the watcher ignores the change we caused.
        """
        self._last_text = text
