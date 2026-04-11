"""
Clipboard watcher for macOS — polls NSPasteboard.changeCount().

Zero-CPU polling: changeCount() reads an integer from shared memory,
no subprocess spawning (unlike pyperclip which shells out to pbpaste).

Requires: pyobjc-framework-Cocoa (in requirements-mac.txt)

Usage (same API as clipboard_watcher.py on Windows):
    watcher = ClipboardWatcher(callback=lambda text: print(text))
    watcher.start()   # spawns daemon thread
    ...
    watcher.stop()    # tears down thread
"""

import logging
import threading
import time

from AppKit import NSPasteboard

logger = logging.getLogger(__name__)


class ClipboardWatcher:
    """Watches for clipboard changes via NSPasteboard and fires a callback."""

    def __init__(self, callback):
        """
        Args:
            callback: Called with (text: str) when clipboard text changes.
                      Only fires for non-empty text that differs from previous.
        """
        self._callback = callback
        self._thread: threading.Thread | None = None
        self._running = False
        self._pb = NSPasteboard.generalPasteboard()
        self._last_count = self._pb.changeCount()
        self._last_text = self._pb.stringForType_("public.utf8-plain-text") or ""

    def start(self):
        """Spawn the watcher thread. Safe to call multiple times (no-ops if running)."""
        if self._running:
            return
        self._running = True
        self._thread = threading.Thread(
            target=self._run, daemon=True, name="clipboard-watcher"
        )
        self._thread.start()
        logger.info("Clipboard watcher started (macOS NSPasteboard)")

    def stop(self):
        """Stop the watcher and clean up."""
        self._running = False
        if self._thread:
            self._thread.join(timeout=2)
            self._thread = None
        logger.info("Clipboard watcher stopped")

    def _run(self):
        """Thread entry: poll changeCount every 500ms."""
        while self._running:
            try:
                count = self._pb.changeCount()
                if count != self._last_count:
                    self._last_count = count
                    text = (
                        self._pb.stringForType_("public.utf8-plain-text") or ""
                    )
                    if text and text != self._last_text:
                        self._last_text = text
                        try:
                            self._callback(text)
                        except Exception:
                            logger.exception("Clipboard callback error")
            except Exception:
                pass
            time.sleep(0.5)

    def update_last_text(self, text: str):
        """Update the internal tracker so our own writes don't echo back.

        Call this BEFORE writing to the clipboard (e.g. type_text_paste)
        so the watcher ignores the change we caused.
        """
        self._last_text = text
