"""
TTS module — converts text to speech audio (MP3 bytes).

Uses OpenAI TTS API. Returns raw MP3 bytes to be sent directly
as binary over the WebRTC data channel (no Base64 encoding).
"""

import logging
import os

from openai import OpenAI

logger = logging.getLogger(__name__)


class TextToSpeech:
    """OpenAI TTS provider — generates MP3 audio from text."""

    def __init__(self):
        api_key = os.getenv("OPENAI_API_KEY", "")
        if not api_key:
            logger.warning("OPENAI_API_KEY not set — TTS will be unavailable")
            self._client = None
        else:
            self._client = OpenAI(api_key=api_key)

    def speak(self, text: str) -> bytes | None:
        """
        Generate MP3 audio for the given text.

        Returns raw MP3 bytes, or None if TTS is unavailable/fails.
        """
        if not self._client:
            logger.warning("TTS unavailable (no API key)")
            return None

        if not text.strip():
            return None

        try:
            response = self._client.audio.speech.create(
                model="tts-1",
                voice="alloy",
                input=text,
                response_format="mp3",
            )
            # response.content is raw bytes
            mp3_bytes = response.content
            logger.info("TTS generated %d bytes for: %.50s...", len(mp3_bytes), text)
            return mp3_bytes

        except Exception:
            logger.exception("TTS generation failed")
            return None
