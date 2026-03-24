"""
Screen capture module — captures the desktop screen for streaming to the phone.

Phase 1: Uses `mss` for fast screen capture.
Future: Will feed frames into a WebRTC video track via aiortc.
"""

import mss


def capture_screen() -> bytes:
    """Capture the primary monitor and return raw PNG bytes."""
    with mss.mss() as sct:
        monitor = sct.monitors[1]  # Primary monitor
        screenshot = sct.grab(monitor)
        return mss.tools.to_png(screenshot.rgb, screenshot.size)


def get_screen_size() -> tuple[int, int]:
    """Return (width, height) of the primary monitor."""
    with mss.mss() as sct:
        monitor = sct.monitors[1]
        return monitor["width"], monitor["height"]
