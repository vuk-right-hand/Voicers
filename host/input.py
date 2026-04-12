"""
Input control module — translates phone commands into mouse/keyboard actions.
Uses pyautogui for cross-platform desktop control.
"""

import asyncio
import sys
import time

import pyautogui
import pyperclip

# ── Clipboard serialization lock ────────────────────────────────────────────────
# type_text_paste() writes to the PC clipboard; get_clipboard_async() reads it.
# Without a lock, a type-text command arriving while a get-clipboard response
# is in-flight will clobber the clipboard mid-read (paste pill gets keyboard text
# instead of the PC selection). Lock is created lazily inside the event loop.
_clipboard_lock: asyncio.Lock | None = None


def _get_clipboard_lock() -> asyncio.Lock:
    global _clipboard_lock
    if _clipboard_lock is None:
        _clipboard_lock = asyncio.Lock()
    return _clipboard_lock


async def type_text_paste_async(text: str, on_before_write=None) -> None:
    """Clipboard-paste with serialization lock.

    Runs blocking pyperclip/pyautogui calls in a thread pool so the aiortc
    event loop is free during the paste (pyperclip + hotkey can block 50-200ms
    on Windows). Saves and restores the previous clipboard content so the user's
    PC clipboard isn't silently clobbered by dictated text.

    on_before_write: optional callback(text) called right before pyperclip.copy()
                     — used by clipboard watcher to suppress echo.
    """
    async with _get_clipboard_lock():
        previous = await asyncio.to_thread(pyperclip.paste)
        if on_before_write:
            on_before_write(text)
        await asyncio.to_thread(type_text_paste, text)
        # 100ms: give the OS time to process Ctrl+V before we overwrite the clipboard
        await asyncio.sleep(0.1)
        if on_before_write:
            on_before_write(previous)
        await asyncio.to_thread(pyperclip.copy, previous)


async def get_clipboard_async() -> str:
    """Read PC clipboard with serialization lock.

    Runs in a thread pool to avoid blocking the aiortc event loop during
    the OS clipboard read (pyperclip.paste() can block on slow systems).
    """
    async with _get_clipboard_lock():
        return await asyncio.to_thread(pyperclip.paste)


async def copy_selection_async(timeout_ms: int = 500) -> str:
    """Send Ctrl+C and wait for the OS clipboard to actually update.

    Snapshots clipboard, fires the hotkey, then polls until the content
    changes or the timeout expires. Eliminates the off-by-one race where
    pyperclip.paste() runs before the foreground app has processed Ctrl+C.
    """
    async with _get_clipboard_lock():
        before = await asyncio.to_thread(pyperclip.paste)
        await asyncio.to_thread(pyautogui.hotkey, "ctrl", "c")
        deadline = time.monotonic() + (timeout_ms / 1000)
        while time.monotonic() < deadline:
            await asyncio.sleep(0.02)
            current = await asyncio.to_thread(pyperclip.paste)
            if current != before:
                return current
        return await asyncio.to_thread(pyperclip.paste)

# Disable fail-safe — tapping the extreme edge of the phone screen sends (0,0)
# which triggers FailSafeException and crashes the host.
pyautogui.FAILSAFE = False
pyautogui.PAUSE = 0  # Zero delay so two rapid taps pass through as a double-click

# Double-click snapping: if second tap arrives within this window and distance,
# snap to first tap's position so the OS registers a double-click.
_DBLCLICK_TIME_MS = 500
_DBLCLICK_SNAP_PX = 60  # max pixel drift on desktop to snap
_last_tap = {"x": 0, "y": 0, "time": 0.0}


def tap(x: float, y: float) -> None:
    """Click at normalized coordinates (0.0-1.0 mapped to screen resolution)."""
    screen_w, screen_h = pyautogui.size()
    abs_x = max(1, min(int(x * screen_w), screen_w - 1))
    abs_y = max(1, min(int(y * screen_h), screen_h - 1))

    now = time.time()
    dt_ms = (now - _last_tap["time"]) * 1000
    dx = abs(abs_x - _last_tap["x"])
    dy = abs(abs_y - _last_tap["y"])

    if dt_ms < _DBLCLICK_TIME_MS and dx < _DBLCLICK_SNAP_PX and dy < _DBLCLICK_SNAP_PX:
        # Snap to first tap position so OS sees exact same coords → double-click
        abs_x = _last_tap["x"]
        abs_y = _last_tap["y"]

    _last_tap["x"] = abs_x
    _last_tap["y"] = abs_y
    _last_tap["time"] = now

    pyautogui.click(abs_x, abs_y)


def type_text(text: str) -> None:
    """Type a string of text character-by-character (slow, for short strings)."""
    pyautogui.typewrite(text, interval=0.02)


def type_text_paste(text: str) -> None:
    """Paste text instantly via clipboard. Use for dictated content (100+ chars)."""
    pyperclip.copy(text)
    if sys.platform == "darwin":
        pyautogui.hotkey("command", "v")
    else:
        pyautogui.hotkey("ctrl", "v")


def scroll(delta: int) -> None:
    """Scroll. Positive = up, negative = down."""
    pyautogui.scroll(delta)


def execute_command(action: str, payload: dict) -> str | None:
    """Execute a system command based on action type."""
    if action == "shortcut":
        # payload: {"keys": ["ctrl", "c"]}
        keys = payload.get("keys", [])
        if keys:
            pyautogui.hotkey(*keys)
        return None

    elif action == "sequence":
        # payload: {"steps": [["ctrl", "a"], ["backspace"]]}
        steps = payload.get("steps", [])
        for step in steps:
            if len(step) == 1:
                pyautogui.press(step[0])
            elif step:
                pyautogui.hotkey(*step)
        return None

    elif action == "focus":
        # TODO: Focus a specific window by title
        return "not_implemented"

    elif action == "open_url":
        import webbrowser
        url = payload.get("url", "")
        if url and (url.startswith("https://") or url.startswith("http://")):
            webbrowser.open(url)
        return None

    return "unknown_action"


# ─── Trackpad Mode ────────────────────────────────────────────────────────────


def mousemove_relative(dx: float, dy: float) -> None:
    """Move mouse cursor relatively by dx, dy pixels."""
    pyautogui.moveRel(int(dx), int(dy))


def mousedown() -> None:
    """Press and hold the primary mouse button."""
    pyautogui.mouseDown()


def mouseup() -> None:
    """Release the primary mouse button."""
    pyautogui.mouseUp()


def click() -> None:
    """Click at current cursor position (no coordinates — trackpad mode)."""
    pyautogui.click()


def double_click() -> None:
    """Double-click at current cursor position (OS-native word select)."""
    pyautogui.doubleClick()


def get_cursor_pos() -> tuple[int, int]:
    """Return current cursor position as (x, y) in screen pixels."""
    return pyautogui.position()
