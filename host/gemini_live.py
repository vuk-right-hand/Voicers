"""
Gemini 2.5 Flash Live API — persistent STT session.

Pipeline:
  WebRTC PCM audio (16kHz Int16) ──> Gemini Live WebSocket ──> on_transcript callback
  - VAD disabled, client controls activity boundaries
  - Proactive activityEnd→activityStart flush every ~15s prevents transcription
    pipeline degradation (known Gemini issue with continuous streaming)
  - Context window compression (SlidingWindow) for unlimited session duration
  - GoAway handling + session resumption for transparent reconnection
  - input_transcription provides real-time ASR, accumulated in interim_buffer
  - Caller flushes interim_buffer as is_final=True on voice-stop
"""
import asyncio
import datetime
import logging
import os
import re
import time
from typing import Callable

import httpx
from dotenv import load_dotenv
from google import genai
from google.genai import types

# Must run before MODEL is read so GEMINI_MODEL in .env overrides the default
# even when this module is imported before supabase_client (which also loads).
load_dotenv()

logger = logging.getLogger(__name__)

# Pinned explicitly — -latest aliases rotate without notice and have broken us
# before. `GEMINI_MODEL` is an env-var escape hatch for hot-swapping without a
# rebuild. See tests/test_model_pinned.py for the allowlist regression guard.
MODEL = os.environ.get(
    "GEMINI_MODEL", "gemini-2.5-flash-native-audio-preview-12-2025"
)

SYSTEM_INSTRUCTION = (
    "You are a transcription engine. Transcribe English audio only. "
    "Output strictly the transcribed text. "
    "Do not answer questions, do not converse, do not provide commentary."
)

# Skip non-English ASR chunks (Arabic, CJK hallucinations).
_HAS_LATIN_OR_DIGIT = re.compile(r"[a-zA-Z0-9]")

# Flush the transcription pipeline every N seconds to prevent degradation.
# Gemini's input_audio_transcription degrades after 20-40s of continuous
# streaming — proactive activityEnd→activityStart resets the pipeline.
_FLUSH_INTERVAL_S = 15


def _fetch_hosted_gemini_token() -> tuple[str, float]:
    """Fetch a Pro-tier ephemeral Gemini token from Vercel.

    Returns (token, monotonic_expire_deadline_seconds).

    The Vercel master key never touches the user's machine — we get a
    fresh 30-min token per session and connect direct to Google's WebSocket.
    Errors are converted to RuntimeError so they don't bubble out as raw
    httpx exceptions and tear down the asyncio task / WebRTC channel.
    """
    site_url = os.environ.get("SITE_URL", "https://voicers.vercel.app")
    user_id = os.environ.get("USER_ID")
    supabase_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not user_id:
        raise RuntimeError(
            "USE_HOSTED_API=true but USER_ID is not set in environment — "
            "re-run the installer with a valid activation file"
        )
    if not supabase_key:
        raise RuntimeError(
            "USE_HOSTED_API=true but SUPABASE_SERVICE_ROLE_KEY is not set — "
            "installer bake-in failed, reinstall"
        )
    try:
        resp = httpx.post(
            f"{site_url}/api/gemini-token",
            headers={
                "Authorization": f"Bearer {supabase_key}",
                "Content-Type": "application/json",
            },
            json={"user_id": user_id},
            timeout=15.0,
        )
        resp.raise_for_status()
        data = resp.json()
        token = data.get("token")
        if not token:
            raise RuntimeError(
                f"Pro token response missing 'token' field: {data}"
            )
        expire_iso = data.get("expireTime")
        seconds_left = 30 * 60
        if expire_iso:
            try:
                wall_expire = datetime.datetime.fromisoformat(
                    expire_iso.replace("Z", "+00:00")
                )
                seconds_left = (
                    wall_expire - datetime.datetime.now(datetime.timezone.utc)
                ).total_seconds()
            except Exception:
                pass
        return token, time.monotonic() + max(60.0, seconds_left)
    except httpx.HTTPStatusError as e:
        raise RuntimeError(
            f"Failed to fetch Pro token: {e.response.status_code} - {e.response.text}"
        )
    except httpx.RequestError as e:
        raise RuntimeError(f"Network error reaching Vercel API: {e}")


class GeminiLive:
    """
    Persistent Gemini Live session for continuous dictation.

    VAD is disabled — client sends activityStart/activityEnd.  A background
    flush task periodically cycles activityEnd→activityStart to keep the
    transcription pipeline fresh.  Context window compression and session
    resumption keep the session alive indefinitely.
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
        self._token_expiry_task: asyncio.Task | None = None
        self._active = False
        self._restarting = False
        self._session = None
        self._session_ctx = None
        self.interim_buffer = ""
        self._last_activity_start: float = 0.0
        self._resumption_handle: str | None = None  # for session resumption
        self._token_expires_at: float | None = None  # hosted-mode only

        # ── Cause B: serialize activity_end / activity_start against audio sends
        self._activity_lock = asyncio.Lock()

        # ── Cause C: turn-state tracking so flush_final doesn't deadlock
        self._turn_active = False
        # Signals fired by _recv_loop on turn_complete or each transcription
        # update — flush_final awaits this to early-exit.
        self._final_signal = asyncio.Event()

        # ── Diagnostics (Cause D/L)
        self._start_ts: float = 0.0
        self._first_audio_ts: float | None = None
        self._first_transcription_ts: float | None = None
        self._chunks_sent_total = 0
        self._transcriptions_total = 0
        self._flushes_total = 0
        self._filter_rejections = 0
        self._peak_qsize: int = 0
        # Rolling 5 s RMS window over the last N chunks (~50 at 100 ms).
        self._rms_window: list[float] = []

        # ── Session-lifecycle promotion (2026-04-17): per-turn tracking.
        # The session is now per-WebRTC-connection (opened on SDP offer,
        # closed on DC close / bye / conn-state-closed). begin_turn() runs
        # once per voice-tap to reset per-turn state and cycle activity
        # boundaries. _turn_counter == 0 means "pre-warm window, no user
        # tap yet" — the first activity_start from start() is still open,
        # so begin_turn() must skip the redundant end/start pair.
        self._turn_counter: int = 0
        # Starts "done" (set) — only clears during an in-flight restart so
        # begin_turn() can block instead of timing out and piling on a
        # redundant second restart.
        self._restart_done_event: asyncio.Event = asyncio.Event()
        self._restart_done_event.set()

    async def start(self, _preserve_buffer: bool = False) -> None:
        """Open Gemini Live session and start send/recv/flush background tasks."""
        # ── CAUSE A fix ─────────────────────────────────────────────────────
        # Flip _active BEFORE any await so incoming PCM queues up while the
        # token fetch + WebSocket handshake run. The queue has 200-slot / 20 s
        # headroom; the guard `if not self._active and not self._restarting`
        # in send_audio was silently dropping the first 3-5 s of audio.
        self._active = True
        self._start_ts = time.monotonic()
        self._first_audio_ts = None
        self._first_transcription_ts = None
        if not _preserve_buffer:
            self.interim_buffer = ""

        use_hosted = os.environ.get("USE_HOSTED_API", "false").strip().lower() == "true"
        api_version = "v1alpha" if use_hosted else "v1beta"

        try:
            if use_hosted:
                # Pro tier — fetch ephemeral token from Vercel, connect via v1alpha
                api_key, self._token_expires_at = await asyncio.to_thread(
                    _fetch_hosted_gemini_token
                )
                client = genai.Client(
                    api_key=api_key,
                    http_options={"api_version": "v1alpha"},
                )
            else:
                # BYOK / Free — local key from .env
                api_key = os.getenv("GEMINI_API_KEY")
                if not api_key:
                    raise RuntimeError("GEMINI_API_KEY not set in environment")
                client = genai.Client(api_key=api_key)
                self._token_expires_at = None
        except Exception:
            # start() failed before _session was assigned — flip _active back
            # off so webrtc_host's error path doesn't leak an "active" GeminiLive.
            self._active = False
            raise

        self._api_key = api_key

        config = types.LiveConnectConfig(
            response_modalities=["AUDIO"],
            input_audio_transcription=types.AudioTranscriptionConfig(),
            realtime_input_config=types.RealtimeInputConfig(
                automatic_activity_detection=types.AutomaticActivityDetection(
                    disabled=True,
                ),
            ),
            # Sliding window compression — prevents context overflow,
            # enables unlimited session duration (default: 15 min without).
            context_window_compression=types.ContextWindowCompressionConfig(
                sliding_window=types.SlidingWindow(),
            ),
            # Session resumption — allows transparent reconnect on GoAway.
            session_resumption=types.SessionResumptionConfig(
                handle=self._resumption_handle,
            ),
            system_instruction=types.Content(
                parts=[types.Part(text=SYSTEM_INSTRUCTION)]
            ),
        )

        try:
            self._session_ctx = client.aio.live.connect(model=MODEL, config=config)
            self._session = await self._session_ctx.__aenter__()

            # With VAD disabled, we MUST send activityStart to tell the server
            # we're speaking.
            await self._session.send_realtime_input(
                activity_start=types.ActivityStart()
            )
            self._last_activity_start = time.monotonic()
            self._turn_active = True
            self._final_signal.clear()
        except Exception:
            self._active = False
            if self._session_ctx is not None:
                try:
                    await self._session_ctx.__aexit__(None, None, None)
                except Exception:
                    pass
                self._session_ctx = None
                self._session = None
            raise

        loop = asyncio.get_running_loop()
        # INVARIANT: _send_task must NOT be spawned before self._session is
        # assigned — _send_loop would pull chunks from the queue while
        # self._session is None and the inner "if self._session is None:
        # continue" guard would silently drop them.
        self._send_task = loop.create_task(self._send_loop(), name="gemini-send")
        self._recv_task = loop.create_task(self._recv_loop(), name="gemini-recv")
        self._flush_task = loop.create_task(self._flush_loop(), name="gemini-flush")
        if self._token_expires_at is not None:
            self._token_expiry_task = loop.create_task(
                self._token_expiry_loop(), name="gemini-token-expiry"
            )

        resumption_status = "resuming" if self._resumption_handle else "new"
        token_expiry_str = (
            f"{self._token_expires_at - time.monotonic():.0f}s"
            if self._token_expires_at else "n/a"
        )
        logger.info(
            "Gemini Live session started (model=%s api_version=%s mode=%s "
            "VAD=off flush=%ds %s token_expires_in=%s)",
            MODEL, api_version, "hosted" if use_hosted else "byok",
            _FLUSH_INTERVAL_S, resumption_status, token_expiry_str,
        )

    async def send_audio(self, pcm_bytes: bytes) -> None:
        """Queue raw 16kHz Int16 PCM chunk for streaming to Gemini."""
        if not self._active and not self._restarting:
            return
        try:
            self._peak_qsize = max(self._peak_qsize, self._audio_queue.qsize() + 1)
            self._audio_queue.put_nowait(pcm_bytes)
        except asyncio.QueueFull:
            if not self._restarting:
                logger.warning("Gemini audio queue full — dropping chunk")

    async def begin_turn(self) -> None:
        """Reset per-turn state and reopen the activity window for a voice-tap.

        Session-lifecycle promotion (2026-04-17): start()/stop() run once per
        WebRTC connection; begin_turn() runs once per voice-tap. Per-turn state
        (interim_buffer, TTF timestamps, RMS window, peak queue) is reset here.
        Session-lifetime counters (chunks/transcriptions/flushes totals)
        accumulate across turns for diagnostic logs.

        Ordering matters:
          1. Wait for any in-flight restart() to complete (up to 3 s). Without
             this, a voice-tap landing mid-29-min-token-refresh would race the
             restart and trigger a redundant second one.
          2. Check preconditions on the live session — caller catches
             RuntimeError and routes to _restart_gemini.
          3. Reset per-turn state.
          4. Under _activity_lock, cycle activity_end → activity_start (skip on
             turn #1 — start() already opened the first activity window during
             pre-warm and sending a redundant end/start would be noise).
        """
        if self._restarting or not self._restart_done_event.is_set():
            # 3 s is deliberately longer than _start_voice's 2 s wait_for so
            # the restart has a real chance to finish before the caller times
            # out and falls through to its own _restart_gemini path.
            await asyncio.wait_for(self._restart_done_event.wait(), timeout=3.0)

        if not self._active or self._session is None:
            raise RuntimeError("begin_turn on dead session")

        self.interim_buffer = ""
        self._first_audio_ts = None
        self._first_transcription_ts = None
        self._rms_window.clear()
        self._peak_qsize = 0
        self._filter_rejections = 0
        self._start_ts = time.monotonic()

        self._final_signal.clear()

        async with self._activity_lock:
            if self._turn_counter == 0:
                # First turn — start() already sent activity_start during
                # pre-warm; don't send a redundant end/start pair.
                self._turn_active = True
            else:
                if self._turn_active:
                    await self._session.send_realtime_input(
                        activity_end=types.ActivityEnd()
                    )
                    self._turn_active = False
                await self._session.send_realtime_input(
                    activity_start=types.ActivityStart()
                )
                self._last_activity_start = time.monotonic()
                self._turn_active = True

        self._turn_counter += 1
        logger.info("begin_turn #%d — per-turn state reset", self._turn_counter)

    async def stop(self) -> None:
        """Gracefully shut down: cancel tasks, drain queue, close session."""
        self._active = False

        while not self._audio_queue.empty():
            try:
                self._audio_queue.get_nowait()
            except asyncio.QueueEmpty:
                break

        try:
            self._audio_queue.put_nowait(None)
        except asyncio.QueueFull:
            pass

        tasks = [t for t in [self._send_task, self._recv_task, self._flush_task, self._token_expiry_task] if t]
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

        duration = time.monotonic() - self._start_ts if self._start_ts else 0.0
        logger.info(
            "Gemini Live session stopped — chunks=%d transcriptions=%d "
            "duration=%.1fs flushes=%d filter_rejections=%d peak_qsize=%d",
            self._chunks_sent_total, self._transcriptions_total, duration,
            self._flushes_total, self._filter_rejections, self._peak_qsize,
        )

    async def restart(self) -> None:
        """Tear down and reopen, preserving interim_buffer and resumption handle."""
        saved_buffer = self.interim_buffer
        self._restarting = True
        # Block begin_turn() from racing a mid-flight restart — a voice-tap
        # landing during the 29-min token refresh would otherwise timeout on
        # its own 2 s wait_for and pile on a redundant second restart.
        self._restart_done_event.clear()

        self._active = False
        tasks = [t for t in [self._send_task, self._recv_task, self._flush_task, self._token_expiry_task] if t]
        for t in tasks:
            t.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        self._send_task = None
        self._recv_task = None
        self._flush_task = None
        self._token_expiry_task = None

        if self._session_ctx is not None:
            try:
                await self._session_ctx.__aexit__(None, None, None)
            except Exception as exc:
                logger.debug("Gemini session close during restart: %s", exc)
            self._session_ctx = None
            self._session = None

        # Don't drain audio queue — buffered chunks flow to new session.

        self.interim_buffer = saved_buffer
        try:
            await self.start(_preserve_buffer=True)
        finally:
            self._restarting = False
            self._restart_done_event.set()
        logger.info("Gemini session restarted — buffer preserved (%d chars), queued chunks: %d",
                     len(saved_buffer), self._audio_queue.qsize())

    # ── Internal tasks ────────────────────────────────────────────────────────

    async def _send_loop(self) -> None:
        """Drain audio queue and stream chunks to Gemini.

        Acquires _activity_lock around each realtime-input send so that
        _flush_loop's activity_end/activity_start pair can atomically bracket
        the send stream without losing audio inside a gap (Cause B).
        """
        chunks_sent = 0
        try:
            while self._active:
                chunk = await self._audio_queue.get()
                if chunk is None:
                    break
                if self._session is None:
                    continue
                try:
                    async with self._activity_lock:
                        await self._session.send_realtime_input(
                            audio=types.Blob(data=chunk, mime_type="audio/pcm;rate=16000")
                        )
                    chunks_sent += 1
                    self._chunks_sent_total = chunks_sent

                    if chunks_sent == 1:
                        self._first_audio_ts = time.monotonic()
                        ttfa_ms = int((self._first_audio_ts - self._start_ts) * 1000)
                        logger.info(
                            "First audio chunk sent to Gemini (%d bytes, time-to-first-audio=%dms)",
                            len(chunk), ttfa_ms,
                        )
                    elif chunks_sent % 100 == 0:
                        logger.debug("Sent %d audio chunks to Gemini", chunks_sent)

                    # Rolling 5 s RMS window (~50 chunks at 100 ms). Warn every
                    # 50 chunks if the window-wide average stays below the
                    # silence floor — catches zero-amplitude mic (Cause L).
                    try:
                        rms = self._rms_of_pcm16le(chunk)
                    except Exception:
                        rms = 0.0
                    self._rms_window.append(rms)
                    if len(self._rms_window) > 50:
                        self._rms_window.pop(0)
                    if chunks_sent % 50 == 0 and len(self._rms_window) >= 50:
                        avg = sum(self._rms_window) / len(self._rms_window)
                        if avg < 0.0002:
                            logger.warning(
                                "Low mic RMS (rolling 5s avg=%.6f) — mic may be "
                                "producing pure silence despite noiseSuppression",
                                avg,
                            )
                except Exception as exc:
                    logger.warning("Gemini send error: %s", exc)
        except asyncio.CancelledError:
            pass
        logger.info(
            "Send loop ended — %d chunks sent total, peak_qsize=%d",
            chunks_sent, self._peak_qsize,
        )

    @staticmethod
    def _rms_of_pcm16le(pcm_bytes: bytes) -> float:
        """Root-mean-square of a 16-bit little-endian PCM buffer, normalized
        to [0,1]. Pure-Python — no numpy import cost per chunk."""
        if not pcm_bytes:
            return 0.0
        # 16-bit little-endian signed
        n = len(pcm_bytes) // 2
        if n == 0:
            return 0.0
        total = 0.0
        # Sample every 4th sample to keep cost bounded at 32 multiplies per
        # 100-ms chunk. Aliasing is not a concern for an amplitude average.
        step = 4
        import struct
        count = 0
        for i in range(0, n, step):
            off = i * 2
            (s,) = struct.unpack_from("<h", pcm_bytes, off)
            total += (s / 32768.0) ** 2
            count += 1
        if count == 0:
            return 0.0
        return (total / count) ** 0.5

    async def _token_expiry_loop(self) -> None:
        """Hosted-mode only: trigger restart() ~60s before the ephemeral token's
        expire_time so we mint a fresh one before frame flow stops at the cap.

        Without this, a Pro session left open >30 min would silently die at
        expire_time with no GoAway and therefore no normal restart trigger.
        """
        if self._token_expires_at is None:
            return
        try:
            while self._active:
                sleep_for = max(10.0, self._token_expires_at - time.monotonic() - 60.0)
                await asyncio.sleep(sleep_for)
                if not self._active:
                    break
                if time.monotonic() >= self._token_expires_at - 60.0:
                    logger.info(
                        "Gemini token nearing expiry — triggering restart for fresh token"
                    )
                    # _on_session_dead schedules restart(), which cancels this
                    # task via asyncio.gather — we may be cancelled before the
                    # break runs. Either path exits the loop cleanly. Also safe
                    # if a GoAway fires in the same window: restart() is guarded
                    # by self._restarting in webrtc_host so only one runs.
                    if self._on_session_dead:
                        self._on_session_dead()
                    break
        except asyncio.CancelledError:
            pass

    async def _flush_loop(self) -> None:
        """Periodically cycle activityEnd→activityStart to reset the
        transcription pipeline before it degrades.

        Takes _activity_lock so the end/start pair brackets against _send_loop
        atomically — audio sent outside [activity_start, activity_end) is
        discarded server-side in VAD-off mode (Cause B).

        The old `break`-on-first-error turned one transient WS blip into a
        permanent flush-off, and transcription degraded 20-40 s later with no
        recovery (Cause I). We now `continue` and retry next cycle.
        """
        flush_count = 0
        try:
            while self._active:
                await asyncio.sleep(_FLUSH_INTERVAL_S)
                if not self._active or self._session is None:
                    break
                try:
                    async with self._activity_lock:
                        await self._session.send_realtime_input(
                            activity_end=types.ActivityEnd()
                        )
                        self._turn_active = False
                        await self._session.send_realtime_input(
                            activity_start=types.ActivityStart()
                        )
                        self._turn_active = True
                    self._last_activity_start = time.monotonic()
                    flush_count += 1
                    self._flushes_total = flush_count
                    logger.info("Pipeline flush #%d complete (activityEnd→activityStart)", flush_count)
                except Exception as exc:
                    logger.warning(
                        "Pipeline flush #%d failed: %s — retrying next cycle",
                        flush_count + 1, exc,
                    )
                    # Keep the loop alive — don't let one WS blip freeze flushing
                    # forever. If the session is genuinely dead, _recv_loop will
                    # exit and trigger _on_session_dead → restart().
        except asyncio.CancelledError:
            pass
        logger.info("Flush loop ended after %d flushes", flush_count)

    async def flush_final(self, timeout: float = 1.5) -> str:
        """Send activity_end and wait briefly for any trailing transcription.

        Called by webrtc_host._stop_voice — the last 200–500 ms of audio is
        typically still in flight when the user taps Stop; its transcription
        arrives after activity_end. Without this wait, those final words are
        dropped on the floor (Cause C).

        Algorithm (deadlock-proof):
          1. Drain the audio queue into the session.
          2. If _turn_active is False — a prior flush already closed the turn
             and we already got turn_complete — return immediately. This is
             the common case when the user pauses between phrases, and the
             guard prevents paying a 1.5 s penalty on every Stop tap.
          3. Otherwise send activity_end and await _final_signal with timeout.
             _recv_loop sets the signal on the next turn_complete OR on any
             input_transcription that arrives after activity_end.
          4. Return self.interim_buffer.
        """
        # Drain buffered audio so it reaches the session before activity_end.
        # Bounded loop — we only pull what's already queued, no blocking get().
        if self._session is not None:
            while not self._audio_queue.empty():
                try:
                    chunk = self._audio_queue.get_nowait()
                except asyncio.QueueEmpty:
                    break
                if chunk is None:
                    break
                try:
                    async with self._activity_lock:
                        await self._session.send_realtime_input(
                            audio=types.Blob(data=chunk, mime_type="audio/pcm;rate=16000")
                        )
                except Exception as exc:
                    logger.debug("flush_final drain send error: %s", exc)
                    break

        if not self._turn_active:
            # Turn already closed — no deadlock, no 1.5 s penalty.
            return self.interim_buffer.strip()

        if self._session is None:
            return self.interim_buffer.strip()

        self._final_signal.clear()
        try:
            async with self._activity_lock:
                await self._session.send_realtime_input(
                    activity_end=types.ActivityEnd()
                )
                self._turn_active = False
        except Exception as exc:
            logger.warning("flush_final activity_end failed: %s", exc)
            return self.interim_buffer.strip()

        try:
            await asyncio.wait_for(self._final_signal.wait(), timeout=timeout)
        except asyncio.TimeoutError:
            logger.info("flush_final: timeout reached at %.2fs — returning buffer as-is", timeout)
        return self.interim_buffer.strip()

    async def _recv_loop(self) -> None:
        """Receive ASR transcriptions and handle session lifecycle events.

        The flush_loop proactively resets activity boundaries every ~15s, so
        the receive iterator will periodically exhaust (turn_complete after
        each activityEnd). We re-enter receive() each time — the session
        and WebSocket stay alive.

        Also handles GoAway (server disconnect warning) and session resumption
        updates for transparent reconnection.
        """
        total_received = 0
        turns = 0
        try:
            while self._active:
                msgs_this_turn = 0
                async for response in self._session.receive():
                    if not self._active:
                        break

                    # ── GoAway: server is about to disconnect ──
                    if hasattr(response, 'go_away') and response.go_away is not None:
                        time_left = getattr(response.go_away, 'time_left', 'unknown')
                        logger.warning("GoAway received — server disconnecting in %s, will restart", time_left)
                        break

                    # ── Session resumption: save handle for reconnection ──
                    if hasattr(response, 'session_resumption_update') and response.session_resumption_update:
                        update = response.session_resumption_update
                        if hasattr(update, 'new_handle') and update.new_handle:
                            self._resumption_handle = update.new_handle
                            logger.debug("Session resumption handle updated")

                    total_received += 1
                    msgs_this_turn += 1

                    content = response.server_content
                    if content is None:
                        continue

                    has_input = hasattr(content, 'input_transcription') and content.input_transcription and content.input_transcription.text
                    has_turn = hasattr(content, 'turn_complete') and content.turn_complete
                    has_model_turn = hasattr(content, 'model_turn') and content.model_turn

                    if has_input:
                        raw = content.input_transcription.text
                        logger.info("  input_transcription: %r", raw[:100])
                        if raw.strip() and _HAS_LATIN_OR_DIGIT.search(raw):
                            self.interim_buffer = (self.interim_buffer + raw).strip()
                            self._transcriptions_total += 1
                            if self._first_transcription_ts is None:
                                self._first_transcription_ts = time.monotonic()
                                logger.info(
                                    "First transcription received (time-to-first-transcription=%dms)",
                                    int((self._first_transcription_ts - self._start_ts) * 1000),
                                )
                            self._on_transcript(self.interim_buffer, False)
                            # Wake any flush_final() waiting on trailing text.
                            self._final_signal.set()
                        elif raw.strip():
                            # Non-Latin hallucination (CJK, Arabic) — Cause J.
                            self._filter_rejections += 1
                            logger.warning(
                                "Non-Latin transcription filtered (rejection #%d): %r",
                                self._filter_rejections, raw[:80],
                            )

                    if has_model_turn:
                        logger.debug("  model_turn (ignored)")

                    if has_turn:
                        turns += 1
                        logger.debug("  turn_complete #%d (expected from flush cycle)", turns)
                        self._turn_active = False
                        # Wake any flush_final() waiting for the turn to close.
                        self._final_signal.set()

                # Iterator exhausted — expected after each flush cycle.
                if not self._active:
                    break
                logger.debug("Receive iterator refreshed after %d msgs — re-entering", msgs_this_turn)

        except asyncio.CancelledError:
            pass
        except Exception as exc:
            logger.error("Gemini recv error: %s", exc, exc_info=True)

        if self._active and self._on_session_dead:
            logger.warning("Recv loop exited while voice active — triggering full session restart")
            self._on_session_dead()
        logger.info("Recv loop ended — %d messages received, %d turns total", total_received, turns)
