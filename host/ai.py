"""
Jarvis AI module — provides contextual voice feedback after command execution.

Takes a screenshot of the desktop, sends it to GPT-4o-mini with the Jarvis persona,
and returns a short spoken confirmation for TTS.
"""

import base64
import io
import logging
import os

import mss
from PIL import Image
from openai import OpenAI

logger = logging.getLogger(__name__)

JARVIS_SYSTEM_PROMPT = (
    "You are the user's elite, highly competent co-pilot. "
    "They just executed a voice command on their code. "
    "Look at the context and give them a 1 to 2 sentence verbal confirmation. "
    "Speak casually, naturally, and confidently. "
    "Never use robotic phrasing. Never read raw code blocks out loud. "
    "Example: 'I've spun up the dev server, it's running on port 3000.' "
    "or 'The deployment failed, looks like a missing environment variable.'"
)

# Downscale width for the screenshot sent to GPT-4o-mini vision
SCREENSHOT_WIDTH = 640


def _capture_screenshot_b64() -> str | None:
    """Capture the screen, downscale, and return as base64 JPEG."""
    try:
        with mss.mss() as sct:
            monitor = sct.monitors[1]
            screenshot = sct.grab(monitor)

        img = Image.frombytes("RGB", screenshot.size, screenshot.rgb)

        # Downscale to ~640px wide
        ratio = SCREENSHOT_WIDTH / img.width
        new_h = int(img.height * ratio)
        img = img.resize((SCREENSHOT_WIDTH, new_h), Image.LANCZOS)

        # Encode as JPEG
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=60)
        return base64.b64encode(buf.getvalue()).decode("utf-8")

    except Exception:
        logger.exception("Screenshot capture failed")
        return None


class JarvisAI:
    """GPT-4o-mini with vision for contextual voice feedback."""

    def __init__(self):
        api_key = os.getenv("OPENAI_API_KEY", "")
        if not api_key:
            logger.warning("OPENAI_API_KEY not set — Jarvis AI unavailable")
            self._client = None
        else:
            self._client = OpenAI(api_key=api_key)

    def get_response(self, user_command: str) -> str | None:
        """
        Generate a Jarvis-style spoken response after a command.

        Takes a screenshot for visual context, sends it with the command
        to GPT-4o-mini, and returns a short verbal confirmation.

        Args:
            user_command: what the user said/did (e.g., "Run", "Save")

        Returns:
            Short spoken text for TTS, or None on failure.
        """
        if not self._client:
            return None

        # Take screenshot for context
        screenshot_b64 = _capture_screenshot_b64()

        messages = [
            {"role": "system", "content": JARVIS_SYSTEM_PROMPT},
        ]

        # Build user message with optional screenshot
        content = []
        content.append({
            "type": "text",
            "text": f'The user just executed: "{user_command}"',
        })

        if screenshot_b64:
            content.append({
                "type": "image_url",
                "image_url": {
                    "url": f"data:image/jpeg;base64,{screenshot_b64}",
                    "detail": "low",
                },
            })

        messages.append({"role": "user", "content": content})

        try:
            response = self._client.chat.completions.create(
                model="gpt-4o-mini",
                messages=messages,
                max_tokens=100,
                temperature=0.7,
            )
            text = response.choices[0].message.content.strip()
            logger.info("Jarvis response: %s", text)
            return text

        except Exception:
            logger.exception("Jarvis AI call failed")
            return None
