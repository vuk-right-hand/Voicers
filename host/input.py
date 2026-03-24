"""
Input control module — translates phone commands into mouse/keyboard actions.
Uses pyautogui for cross-platform desktop control.
"""

import pyautogui

# Safety: disable pyautogui's fail-safe (move mouse to corner to abort)
# Keep enabled during development
pyautogui.FAILSAFE = True
pyautogui.PAUSE = 0.02  # Small delay between actions for reliability


def tap(x: float, y: float) -> None:
    """Click at normalized coordinates (0.0-1.0 mapped to screen resolution)."""
    screen_w, screen_h = pyautogui.size()
    abs_x = int(x * screen_w)
    abs_y = int(y * screen_h)
    pyautogui.click(abs_x, abs_y)


def type_text(text: str) -> None:
    """Type a string of text."""
    pyautogui.typewrite(text, interval=0.02)


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
