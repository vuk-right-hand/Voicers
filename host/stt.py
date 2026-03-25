"""
Deepgram STT — streaming speech-to-text via WebSocket.

Receives raw PCM audio (16kHz, 16-bit, mono) from the phone via data channel,
forwards it to Deepgram, and returns interim/final transcriptions.
"""

import asyncio
import json
import logging
import os

import websockets
from websockets.protocol import State as WsState

logger = logging.getLogger(__name__)

DEEPGRAM_WS_URL = "wss://api.deepgram.com/v1/listen"

# Keyword boosting for coding vocabulary
KEYWORDS = [
    "Next.js:10",
    "FastAPI:10",
    "pyautogui:10",
    "Supabase:10",
    "WebRTC:10",
    "TypeScript:10",
    "JavaScript:10",
    "Python:10",
    "React:10",
    "Tailwind:10",
    "const:5",
    "function:5",
    "async:5",
    "await:5",
    "import:5",
]


class DeepgramSTT:
    """Streaming STT session using Deepgram's WebSocket API."""

    def __init__(self, on_transcript):
        """
        Args:
            on_transcript: callback(text: str, is_final: bool) — called for each result.
        """
        self._on_transcript = on_transcript
        self._ws = None
        self._receive_task = None
        self._api_key = os.getenv("DEEPGRAM_API_KEY", "")

    async def start(self):
        """Open WebSocket to Deepgram and start receiving transcriptions."""
        if not self._api_key:
            logger.error("DEEPGRAM_API_KEY not set in .env")
            return

        params = "&".join([
            "model=nova-2",
            "language=en",
            "smart_format=true",
            "interim_results=true",
            "endpointing=300",
            "encoding=linear16",
            "sample_rate=16000",
            "channels=1",
        ] + [f"keywords={kw}" for kw in KEYWORDS])

        url = f"{DEEPGRAM_WS_URL}?{params}"

        try:
            self._ws = await websockets.connect(
                url,
                additional_headers={"Authorization": f"Token {self._api_key}"},
            )
            self._receive_task = asyncio.create_task(self._receive_loop())
            logger.info("Deepgram STT session started")
        except Exception:
            logger.exception("Failed to connect to Deepgram")
            self._ws = None

    async def send_audio(self, pcm_bytes: bytes):
        """Forward raw PCM audio bytes to Deepgram."""
        if self._ws and self._ws.state == WsState.OPEN:
            try:
                await self._ws.send(pcm_bytes)
            except websockets.exceptions.ConnectionClosed:
                pass  # Survive transient network drops
            except Exception:
                logger.warning("Failed to send audio to Deepgram")

    async def stop(self):
        """Gracefully close the Deepgram session."""
        if self._ws and self._ws.state == WsState.OPEN:
            try:
                # Send empty byte to signal end of audio
                await self._ws.send(b"")
                # Give it a moment to flush final results
                await asyncio.sleep(0.5)
                await self._ws.close()
            except Exception:
                pass

        if self._receive_task and not self._receive_task.done():
            self._receive_task.cancel()
            try:
                await self._receive_task
            except asyncio.CancelledError:
                pass

        self._ws = None
        self._receive_task = None
        logger.info("Deepgram STT session stopped")

    async def _receive_loop(self):
        """Listen for transcription results from Deepgram."""
        try:
            async for message in self._ws:
                try:
                    data = json.loads(message)

                    # Deepgram sends results in channel.alternatives
                    channel = data.get("channel", {})
                    alternatives = channel.get("alternatives", [])
                    if not alternatives:
                        continue

                    text = alternatives[0].get("transcript", "").strip()
                    if not text:
                        continue

                    is_final = data.get("is_final", False)
                    self._on_transcript(text, is_final)

                except (json.JSONDecodeError, KeyError, IndexError):
                    continue

        except websockets.exceptions.ConnectionClosed:
            logger.info("Deepgram WebSocket closed")
        except asyncio.CancelledError:
            pass
        except Exception:
            logger.exception("Deepgram receive loop error")
