"""
Input control module — translates phone commands into mouse/keyboard actions.
Uses pyautogui for cross-platform desktop control.
"""

import sys
import time

import pyautogui
import pyperclip

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
        if url:
            webbrowser.open(url)
        return None

    return "unknown_action"
