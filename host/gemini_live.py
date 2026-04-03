"""
Gemini 2.5 Flash Live API — persistent STT session.

Pipeline:
  WebRTC PCM audio (16kHz Int16) ──> Gemini Live WebSocket ──> on_transcript callback
  - VAD disabled + activityStart sent once → model never auto-responds → session stays open
  - input_transcription provides real-time ASR, accumulated in interim_buffer
  - Caller flushes interim_buffer as is_final=True on voice-stop
"""
import asyncio
import logging
import os
import re
import time
from typing import Callable

from google import genai
from google.genai import types

logger = logging.getLogger(__name__)

MODEL = "gemini-2.5-flash-native-audio-latest"

SYSTEM_INSTRUCTION = (
    "You are a transcription engine. Transcribe English audio only. "
    "Output strictly the transcribed text. "
    "Do not answer questions, do not converse, do not provide commentary."
)

# Skip non-English ASR chunks (Arabic, CJK hallucinations).
# Allow Latin letters AND digits — Gemini may transcribe "ten" as "10".
_HAS_LATIN_OR_DIGIT = re.compile(r"[a-zA-Z0-9]")


class GeminiLive:
    """
    Persistent Gemini Live session for continuous dictation.

    VAD is disabled and we send activityStart once — the model never detects
    end-of-speech, never responds, and the session stays open indefinitely.
    Pure one-way ASR via input_transcription.
    """

    def __init__(
        self,
        on_transcript: Callable[[str, bool], None],
        on_session_dead: Callable[[], None] | None = None,
    ) -> None:
        self._on_transcript = on_transcript
        self._on_session_dead = on_session_dead
        self._audio_queue: asyncio.Queue[bytes | None] = asyncio.Queue(maxsize=200)
        self._send_task: asyncio.Task | None = None
        self._recv_task: asyncio.Task | None = None
        self._active = False
        self._session = None
        self._session_ctx = None
        self.interim_buffer = ""  # public — caller reads this for final text
        self._last_activity_start: float = 0.0  # throttle turn_complete → activityStart

    async def start(self, _preserve_buffer: bool = False) -> None:
        """Open Gemini Live session and start send/recv background tasks."""
        api_key = os.getenv("GEMINI_API_KEY")
        if not api_key:
            raise RuntimeError("GEMINI_API_KEY not set in environment")

        self._api_key = api_key
        self._active = True
        if not _preserve_buffer:
            self.interim_buffer = ""

        client = genai.Client(api_key=api_key)

        config = types.LiveConnectConfig(
            response_modalities=["AUDIO"],
            input_audio_transcription=types.AudioTranscriptionConfig(),
            output_audio_transcription=types.AudioTranscriptionConfig(),
            realtime_input_config=types.RealtimeInputConfig(
                automatic_activity_detection=types.AutomaticActivityDetection(
                    disabled=True,
                ),
            ),
            system_instruction=types.Content(
                parts=[types.Part(text=SYSTEM_INSTRUCTION)]
            ),
        )

        self._session_ctx = client.aio.live.connect(model=MODEL, config=config)
        self._session = await self._session_ctx.__aenter__()

        # With VAD disabled, we MUST send activityStart to tell the server
        # we're speaking. We never send activityEnd → model never responds
        # → session stays open indefinitely.
        await self._session.send_realtime_input(
            activity_start=types.ActivityStart()
        )

        loop = asyncio.get_running_loop()
        self._send_task = loop.create_task(self._send_loop(), name="gemini-send")
        self._recv_task = loop.create_task(self._recv_loop(), name="gemini-recv")
        logger.info("Gemini Live session started (model=%s, VAD=off)", MODEL)

    async def send_audio(self, pcm_bytes: bytes) -> None:
        """Queue raw 16kHz Int16 PCM chunk for streaming to Gemini."""
        if not self._active:
            return
        try:
            self._audio_queue.put_nowait(pcm_bytes)
        except asyncio.QueueFull:
            logger.warning("Gemini audio queue full — dropping chunk")

    async def stop(self) -> None:
        """Gracefully shut down: cancel tasks, drain queue, close session."""
        self._active = False

        # Drain queue
        while not self._audio_queue.empty():
            try:
                self._audio_queue.get_nowait()
            except asyncio.QueueEmpty:
                break

        # Unblock _send_loop
        try:
            self._audio_queue.put_nowait(None)
        except asyncio.QueueFull:
            pass

        tasks = [t for t in [self._send_task, self._recv_task] if t]
        for t in tasks:
            t.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

        if self._session_ctx is not None:
            try:
                await self._session_ctx.__aexit__(None, None, None)
            except Exception as exc:
                logger.debug("Gemini session close: %s", exc)
            self._session_ctx = None
            self._session = None

        logger.info("Gemini Live session stopped")

    async def restart(self) -> None:
        """Tear down the dead session and open a fresh one, preserving interim_buffer."""
        saved_buffer = self.interim_buffer

        # Cancel tasks and close session without touching interim_buffer
        self._active = False
        tasks = [t for t in [self._send_task, self._recv_task] if t]
        for t in tasks:
            t.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        self._send_task = None
        self._recv_task = None

        if self._session_ctx is not None:
            try:
                await self._session_ctx.__aexit__(None, None, None)
            except Exception as exc:
                logger.debug("Gemini session close during restart: %s", exc)
            self._session_ctx = None
            self._session = None

        # Drain the audio queue
        while not self._audio_queue.empty():
            try:
                self._audio_queue.get_nowait()
            except asyncio.QueueEmpty:
                break

        # Restore buffer and boot fresh session (flag tells start() not to clear it)
        self.interim_buffer = saved_buffer
        await self.start(_preserve_buffer=True)
        logger.info("Gemini session restarted — buffer preserved (%d chars)", len(saved_buffer))

    # ── Internal tasks ────────────────────────────────────────────────────────

    async def _send_loop(self) -> None:
        """Drain audio queue and stream chunks to Gemini."""
        chunks_sent = 0
        try:
            while self._active:
                chunk = await self._audio_queue.get()
                if chunk is None:
                    break
                if self._session is None:
                    continue
                try:
                    await self._session.send_realtime_input(
                        audio=types.Blob(data=chunk, mime_type="audio/pcm;rate=16000")
                    )
                    chunks_sent += 1
                    if chunks_sent == 1:
                        logger.info("First audio chunk sent to Gemini (%d bytes)", len(chunk))
                    elif chunks_sent % 100 == 0:
                        logger.debug("Sent %d audio chunks to Gemini", chunks_sent)
                except Exception as exc:
                    logger.warning("Gemini send error: %s", exc)
        except asyncio.CancelledError:
            pass
        logger.info("Send loop ended — %d chunks sent total", chunks_sent)

    async def _recv_loop(self) -> None:
        """Receive ASR transcriptions. Session stays open (VAD disabled, no turn_complete)."""
        msgs_received = 0
        try:
            async for response in self._session.receive():
                if not self._active:
                    break

                msgs_received += 1

                content = response.server_content
                if content is None:
                    continue

                # Raw ASR — accumulated for progressive UI feedback
                if hasattr(content, 'input_transcription') and content.input_transcription and content.input_transcription.text:
                    raw = content.input_transcription.text
                    # English filter: skip chunks with no Latin characters
                    if raw.strip() and _HAS_LATIN_OR_DIGIT.search(raw):
                        self.interim_buffer = (self.interim_buffer + raw).strip()
                        self._on_transcript(self.interim_buffer, False)

                # turn_complete fires when Gemini thinks the user stopped speaking.
                # Re-send activityStart to keep the turn open so audio sent after
                # a pause is still transcribed. Throttle to max once per 2s to
                # prevent a tight loop if Gemini keeps firing turn_complete.
                if hasattr(content, 'turn_complete') and content.turn_complete:
                    now = time.monotonic()
                    if now - self._last_activity_start >= 2.0:
                        logger.warning("turn_complete received — reopening turn with activityStart")
                        try:
                            await self._session.send_realtime_input(
                                activity_start=types.ActivityStart()
                            )
                            self._last_activity_start = now
                        except Exception as exc:
                            logger.warning("Failed to reopen turn after turn_complete: %s", exc)
                    else:
                        logger.debug("turn_complete received — throttled (%.1fs since last activityStart)",
                                     now - self._last_activity_start)

        except asyncio.CancelledError:
            pass
        except Exception as exc:
            logger.error("Gemini recv error: %s", exc, exc_info=True)
            if self._active and self._on_session_dead:
                self._on_session_dead()
        logger.info("Recv loop ended — %d messages received total", msgs_received)
