"""
Gemini 2.5 Flash Live API — persistent STT session.

Pipeline:
  WebRTC PCM audio (16kHz Int16) ──> Gemini Live WebSocket ──> on_transcript callback
  - VAD disabled, client controls activity boundaries
  - Proactive activityEnd→activityStart flush every ~15s prevents transcription
    pipeline degradation (known Gemini issue with continuous streaming)
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

# Flush the transcription pipeline every N seconds to prevent degradation.
# Gemini's input_audio_transcription degrades after 20-40s of continuous
# streaming — proactive activityEnd→activityStart resets the pipeline.
_FLUSH_INTERVAL_S = 15


class GeminiLive:
    """
    Persistent Gemini Live session for continuous dictation.

    VAD is disabled — client sends activityStart/activityEnd.  A background
    flush task periodically cycles activityEnd→activityStart to keep the
    transcription pipeline fresh.  One WebSocket session from start to stop.
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
        self._flush_task: asyncio.Task | None = None
        self._active = False
        self._restarting = False  # True during restart — send_audio still queues
        self._session = None
        self._session_ctx = None
        self.interim_buffer = ""  # public — caller reads this for final text
        self._last_activity_start: float = 0.0

    async def start(self, _preserve_buffer: bool = False) -> None:
        """Open Gemini Live session and start send/recv/flush background tasks."""
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
        # we're speaking.
        await self._session.send_realtime_input(
            activity_start=types.ActivityStart()
        )
        self._last_activity_start = time.monotonic()

        loop = asyncio.get_running_loop()
        self._send_task = loop.create_task(self._send_loop(), name="gemini-send")
        self._recv_task = loop.create_task(self._recv_loop(), name="gemini-recv")
        self._flush_task = loop.create_task(self._flush_loop(), name="gemini-flush")
        logger.info("Gemini Live session started (model=%s, VAD=off, flush=%ds)", MODEL, _FLUSH_INTERVAL_S)

    async def send_audio(self, pcm_bytes: bytes) -> None:
        """Queue raw 16kHz Int16 PCM chunk for streaming to Gemini."""
        if not self._active and not self._restarting:
            return
        try:
            self._audio_queue.put_nowait(pcm_bytes)
        except asyncio.QueueFull:
            # During restart, silently drop — queue will drain into new session
            if not self._restarting:
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

        tasks = [t for t in [self._send_task, self._recv_task, self._flush_task] if t]
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
        self._restarting = True  # send_audio() keeps queueing during restart

        # Cancel tasks and close session without touching interim_buffer
        self._active = False
        tasks = [t for t in [self._send_task, self._recv_task, self._flush_task] if t]
        for t in tasks:
            t.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        self._send_task = None
        self._recv_task = None
        self._flush_task = None

        if self._session_ctx is not None:
            try:
                await self._session_ctx.__aexit__(None, None, None)
            except Exception as exc:
                logger.debug("Gemini session close during restart: %s", exc)
            self._session_ctx = None
            self._session = None

        # Don't drain the audio queue — let buffered chunks flow to new session.

        # Restore buffer and boot fresh session (flag tells start() not to clear it)
        self.interim_buffer = saved_buffer
        try:
            await self.start(_preserve_buffer=True)
        finally:
            self._restarting = False
        logger.info("Gemini session restarted — buffer preserved (%d chars), queued chunks: %d",
                     len(saved_buffer), self._audio_queue.qsize())

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

    async def _flush_loop(self) -> None:
        """Periodically cycle activityEnd→activityStart to reset the
        transcription pipeline before it degrades (~20-40s of continuous
        streaming causes input_audio_transcription to degrade or stop).
        """
        try:
            while self._active:
                await asyncio.sleep(_FLUSH_INTERVAL_S)
                if not self._active or self._session is None:
                    break
                try:
                    await self._session.send_realtime_input(
                        activity_end=types.ActivityEnd()
                    )
                    await self._session.send_realtime_input(
                        activity_start=types.ActivityStart()
                    )
                    self._last_activity_start = time.monotonic()
                    logger.debug("Transcription pipeline flushed (activityEnd→activityStart)")
                except Exception as exc:
                    logger.warning("Pipeline flush failed: %s", exc)
                    break
        except asyncio.CancelledError:
            pass

    async def _recv_loop(self) -> None:
        """Receive ASR transcriptions.

        The flush_loop proactively resets activity boundaries every ~15s, so
        the receive iterator will periodically exhaust (turn_complete after
        each activityEnd). We just re-enter receive() each time — the session
        and WebSocket stay alive.
        """
        total_received = 0
        try:
            while self._active:
                msgs_this_turn = 0
                async for response in self._session.receive():
                    if not self._active:
                        break

                    total_received += 1
                    msgs_this_turn += 1

                    content = response.server_content
                    if content is None:
                        continue

                    has_input = hasattr(content, 'input_transcription') and content.input_transcription and content.input_transcription.text
                    has_turn = hasattr(content, 'turn_complete') and content.turn_complete
                    has_model_turn = hasattr(content, 'model_turn') and content.model_turn

                    # Raw ASR — accumulated for progressive UI feedback
                    if has_input:
                        raw = content.input_transcription.text
                        logger.info("  input_transcription: %r", raw[:100])
                        if raw.strip() and _HAS_LATIN_OR_DIGIT.search(raw):
                            self.interim_buffer = (self.interim_buffer + raw).strip()
                            self._on_transcript(self.interim_buffer, False)

                    if has_model_turn:
                        logger.debug("  model_turn (ignored)")

                    if has_turn:
                        logger.debug("  turn_complete (expected from flush cycle)")

                # Iterator exhausted — expected after each flush cycle's
                # activityEnd triggers a turn_complete. Just re-enter receive().
                if not self._active:
                    break
                logger.debug("Receive iterator refreshed after %d msgs — re-entering", msgs_this_turn)

        except asyncio.CancelledError:
            pass
        except Exception as exc:
            logger.error("Gemini recv error: %s", exc, exc_info=True)

        # If we're still supposed to be active but the loop exited,
        # the Gemini session died — trigger auto-restart.
        if self._active and self._on_session_dead:
            logger.warning("Recv loop exited while voice active — triggering full session restart")
            self._on_session_dead()
        logger.info("Recv loop ended — %d messages received total", total_received)
