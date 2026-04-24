"""
WebRTC host — streams desktop screen to phone and receives commands via data channel.

The host is NOT the caller. It waits for an SDP offer from the phone (via Supabase
Realtime), then responds with an SDP answer. The phone creates the data channel.
"""

import asyncio
import json
import logging
import os
import time
from fractions import Fraction

import httpx
import mss
import numpy as np
import pyautogui
from PIL import Image
from aiortc import RTCPeerConnection, RTCSessionDescription, RTCConfiguration, RTCIceServer
from aiortc.contrib.media import MediaStreamTrack
import av

from input import (
    tap, type_text, scroll, execute_command,
    mousemove_relative, mousedown, mouseup, click, double_click,
    get_cursor_pos,
    type_text_paste_async, get_clipboard_async, copy_selection_async,
)
import sys
if sys.platform == "darwin":
    from clipboard_watcher_mac import ClipboardWatcher
else:
    from clipboard_watcher import ClipboardWatcher
from gemini_live import GeminiLive
from screen import get_screen_size
from supabase_client import (
    upsert_session_async,
    write_signaling_async,
    update_pc_status_async,
    subscribe_signaling,
    check_subscription_blocked_async,
    USER_ID,
    SUPABASE_KEY,
)

logger = logging.getLogger(__name__)


SITE_URL = os.environ.get("SITE_URL", "https://voicers.vercel.app")


def _fetch_cf_direct() -> list:
    """Call Cloudflare TURN API directly (BYOK path)."""
    key_id = os.environ.get("CF_TURN_KEY_ID", "").strip()
    api_token = os.environ.get("CF_TURN_API_TOKEN", "").strip()
    url = (
        f"https://rtc.live.cloudflare.com/v1/turn/keys/"
        f"{key_id}/credentials/generate-ice-servers"
    )
    resp = httpx.post(
        url,
        headers={
            "Authorization": f"Bearer {api_token}",
            "Content-Type": "application/json",
        },
        json={"ttl": 86400},
        timeout=10.0,
    )
    resp.raise_for_status()
    return resp.json()["iceServers"]


def _fetch_cf_hosted() -> list:
    """Call our server-side API for TURN credentials (Pro path)."""
    resp = httpx.post(
        f"{SITE_URL}/api/turn-credentials",
        headers={
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Content-Type": "application/json",
        },
        json={"user_id": USER_ID},
        timeout=10.0,
    )
    resp.raise_for_status()
    return resp.json()["iceServers"]


async def _generate_cf_ice_servers() -> tuple[list | None, str]:
    """Generate ephemeral Cloudflare TURN credentials.

    Returns (ice_servers_json, turn_status) where turn_status is
    "active", "error", or "none".

    Two paths:
    - BYOK: calls Cloudflare directly using local CF_TURN_KEY_ID/CF_TURN_API_TOKEN
    - Pro (USE_HOSTED_API=true): calls our server-side API which holds the CF secret
    """
    use_hosted = os.environ.get("USE_HOSTED_API", "false").strip().lower() == "true"
    has_local_keys = (
        os.environ.get("CF_TURN_KEY_ID", "").strip()
        and os.environ.get("CF_TURN_API_TOKEN", "").strip()
    )

    if not use_hosted and not has_local_keys:
        return None, "none"

    try:
        if use_hosted:
            ice_servers = await asyncio.to_thread(_fetch_cf_hosted)
            logger.info("TURN credentials from hosted API (%d servers)", len(ice_servers))
        else:
            ice_servers = await asyncio.to_thread(_fetch_cf_direct)
            logger.info("TURN credentials from Cloudflare direct (%d servers)", len(ice_servers))
        return ice_servers, "active"
    except Exception as exc:
        logger.warning("TURN credential generation failed: %s", exc)
        return None, "error"


def _build_rtc_config(ice_servers_json: list | None = None) -> RTCConfiguration:
    """Build RTCConfiguration with STUN always on, Cloudflare TURN if available."""
    ice_servers = [
        RTCIceServer(urls=["stun:stun.l.google.com:19302"]),
        RTCIceServer(urls=["stun:stun1.l.google.com:19302"]),
    ]
    if ice_servers_json:
        for server in ice_servers_json:
            urls = server.get("urls", [])
            username = server.get("username")
            credential = server.get("credential")
            if username and credential:
                ice_servers.append(RTCIceServer(
                    urls=urls, username=username, credential=credential,
                ))
    return RTCConfiguration(iceServers=ice_servers)


# Target resolution for streaming (downscale from native)
STREAM_WIDTH = 1920
STREAM_HEIGHT = 1080
TARGET_FPS = 25


class ScreenCaptureTrack(MediaStreamTrack):
    """Custom video track that captures the desktop screen via mss."""

    kind = "video"

    def __init__(self):
        super().__init__()
        self._sct = mss.mss()
        self._monitor = self._sct.monitors[1]
        self._frame_count = 0
        self._start_time = time.time()

    async def recv(self) -> av.VideoFrame:
        # Pace frames to target FPS
        pts, time_base = await self.next_timestamp()

        # Capture screen
        screenshot = self._sct.grab(self._monitor)
        img = Image.frombytes("RGB", screenshot.size, screenshot.rgb)

        # Downscale to streaming resolution
        img = img.resize((STREAM_WIDTH, STREAM_HEIGHT), Image.LANCZOS)

        # Convert to av.VideoFrame
        frame = av.VideoFrame.from_ndarray(np.array(img), format="rgb24")
        frame.pts = pts
        frame.time_base = time_base

        self._frame_count += 1
        return frame

    async def next_timestamp(self):
        """Calculate PTS for consistent frame timing."""
        if self._frame_count == 0:
            self._start_time = time.time()

        # Wait until it's time for the next frame
        target_time = self._start_time + (self._frame_count / TARGET_FPS)
        wait = target_time - time.time()
        if wait > 0:
            await asyncio.sleep(wait)

        pts = int(self._frame_count * (1 / TARGET_FPS) * 90000)  # 90kHz clock
        time_base = Fraction(1, 90000)
        return pts, time_base


class WebRTCHost:
    """Manages the WebRTC connection lifecycle for the desktop host."""

    def __init__(self):
        self.session_id: str | None = None
        self.pc: RTCPeerConnection | None = None
        self.data_channel = None
        self._ice_queue: list = []
        self._remote_description_set = False
        self._channel = None  # Supabase Realtime channel
        self._running = False

        # Voice engine
        self._gemini: GeminiLive | None = None
        self._voice_active = False
        self._voice_mode: str | None = None  # "dictation" | "command"
        self._gemini_restarting = False
        self._voice_starting_task: asyncio.Task | None = None
        self._no_audio_watchdog: asyncio.Task | None = None
        self._mid_session_watchdog: asyncio.Task | None = None
        self._last_audio_chunk_ts: float = 0.0
        self._mic_info: dict | None = None
        self._pending_status_flushes: list[dict] = []

        # Session-lifecycle promotion (2026-04-17). Gemini session is now per
        # WebRTC connection: pre-warm fires at offer-time, teardown on DC
        # close / bye / conn-state-closed. _start_voice awaits _gemini_ready
        # before calling begin_turn() — the only per-turn entry point.
        self._gemini_ready: asyncio.Event | None = None
        self._gemini_prewarm_task: asyncio.Task | None = None
        # Tap-to-first-transcript telemetry. None until _start_voice stamps
        # it; reset in _stop_voice for per-turn lifecycle symmetry. _logged
        # flag so only the first transcription of a turn logs the delta.
        self._voice_start_ts: float | None = None
        self._voice_start_logged: bool = False

        # Clipboard watcher (pushes PC clipboard changes to phone)
        self._clipboard_watcher = ClipboardWatcher(callback=self._on_clipboard_change)

        # Subscription blocked flag (checked on start, rechecked on connect)
        self._subscription_blocked: bool = False

        # Self-restart watchdog: exit after this many completed connections so
        # Task Scheduler resurrects a clean process (prevents leaked aioice/TURN
        # state from accumulating over a long uptime).
        self._connection_count: int = 0
        self._max_connections: int = 20

        # Cloudflare TURN credentials (refreshed every 12h)
        self._ice_servers_json: list | None = None
        self._turn_status: str = "none"
        self._turn_refresh_task: asyncio.Task | None = None

    async def start(self):
        """Boot up: upsert session, subscribe to signaling, wait for offer."""
        try:
            self._subscription_blocked = await check_subscription_blocked_async()
            logger.info("Subscription blocked: %s", self._subscription_blocked)
        except Exception:
            logger.warning("Could not check subscription, allowing connection")
            self._subscription_blocked = False

        # Generate Cloudflare TURN credentials before creating session
        self._ice_servers_json, self._turn_status = await _generate_cf_ice_servers()

        self.session_id = await upsert_session_async(
            ice_servers=self._ice_servers_json,
            turn_status=self._turn_status,
        )
        self._running = True

        # Subscribe to Realtime for signaling (now async, returns a task)
        self._channel = await subscribe_signaling(
            self.session_id, self._on_signaling_data
        )

        # Background credential refresh every 12h (only if CF keys are configured)
        if self._turn_status != "none":
            self._turn_refresh_task = asyncio.create_task(
                self._maintain_turn_credentials()
            )

        screen_w, screen_h = get_screen_size()
        logger.info(
            "Host ready. Session: %s, Screen: %dx%d, TURN: %s. Waiting for phone offer...",
            self.session_id, screen_w, screen_h, self._turn_status,
        )

    def _on_signaling_data(self, data: dict):
        """Handle incoming signaling messages from Supabase Realtime."""
        sig_type = data.get("type")

        if sig_type == "offer" and data.get("from") == "phone":
            logger.info("Received SDP offer from phone")
            loop = asyncio.get_running_loop()
            loop.create_task(self._safe_handle_offer(data["sdp"]))

        elif sig_type == "ice-candidate" and data.get("from") == "phone":
            loop = asyncio.get_running_loop()
            loop.create_task(self._safe_handle_ice_candidate(data["candidate"]))

    async def _safe_handle_offer(self, sdp: str):
        """Wrapper with error handling around _handle_offer."""
        try:
            await self._handle_offer(sdp)
        except Exception:
            logger.exception("FAILED to handle SDP offer")
            # Reset to host-ready so the phone can retry
            if self.session_id:
                await write_signaling_async(self.session_id, {
                    "type": "host-ready",
                    "host_id": USER_ID,
                    "ice_servers": self._ice_servers_json,
                    "turn_status": self._turn_status,
                })

    async def _safe_handle_ice_candidate(self, candidate_str: str):
        """Wrapper with error handling around _handle_ice_candidate."""
        try:
            await self._handle_ice_candidate(candidate_str)
        except Exception:
            logger.exception("FAILED to handle ICE candidate")

    async def _handle_offer(self, sdp: str):
        """Process SDP offer from phone and generate answer."""
        # Recheck subscription on each connection (catches upgrades/cancellations)
        try:
            self._subscription_blocked = await check_subscription_blocked_async()
            logger.info("Subscription blocked recheck: %s", self._subscription_blocked)
        except Exception:
            logger.warning("Subscription recheck failed, keeping: %s", self._subscription_blocked)

        if self._subscription_blocked:
            logger.warning("Rejecting connection — subscription canceled/unpaid")
            await write_signaling_async(self.session_id, {
                "type": "rejected",
                "reason": "subscription_expired",
            })
            return

        # Gemini pre-warm fires at offer-time, BEFORE setRemoteDescription.
        # DC on_open lands 1-2 s later (ICE gathering + DTLS) — running the
        # Gemini handshake in parallel with ICE reclaims that window as a
        # free latency win on tap #1. Env-var rollback: GEMINI_PREWARM=false
        # leaves _gemini_ready None and forces _start_voice down the legacy
        # create-and-start-inline branch.
        if os.environ.get("GEMINI_PREWARM", "true").lower() == "true":
            self._gemini_ready = asyncio.Event()
            loop = asyncio.get_running_loop()
            self._gemini_prewarm_task = loop.create_task(self._prewarm_gemini())

        # Clean up any previous connection
        if self.pc:
            await self.pc.close()

        rtc_config = _build_rtc_config(self._ice_servers_json)
        logger.info("ICE servers: %s", [s.urls for s in rtc_config.iceServers])
        self.pc = RTCPeerConnection(configuration=rtc_config)
        self._ice_queue = []
        self._remote_description_set = False

        # Add screen capture video track
        video_track = ScreenCaptureTrack()
        self.pc.addTrack(video_track)

        # Handle data channel created by the phone
        @self.pc.on("datachannel")
        def on_datachannel(channel):
            logger.info("Data channel received: %s", channel.label)
            self.data_channel = channel
            self._setup_data_channel(channel)

        # Handle connection state changes
        @self.pc.on("connectionstatechange")
        async def on_connection_state():
            await self._on_connection_state(self.pc.connectionState)

        # Set remote description (the offer)
        offer = RTCSessionDescription(sdp=sdp, type="offer")
        await self.pc.setRemoteDescription(offer)
        self._remote_description_set = True

        # Process any queued ICE candidates
        for candidate in self._ice_queue:
            await self.pc.addIceCandidate(candidate)
        self._ice_queue.clear()

        # Create and set local description (the answer)
        # aiortc gathers all ICE candidates during this step (no trickle)
        answer = await self.pc.createAnswer()
        await self.pc.setLocalDescription(answer)

        # Best-effort: hint higher bitrate for the video sender
        try:
            for sender in self.pc.getSenders():
                if sender.track and sender.track.kind == "video":
                    params = sender.getParameters()
                    if params.encodings:
                        params.encodings[0].maxBitrate = 3_000_000  # 3 Mbps
                        await sender.setParameters(params)
        except Exception:
            pass  # aiortc may not honour this; 1080p resolution is the real fix

        # Send answer to phone via Supabase — async so the event loop stays free
        # while ICE candidates are already arriving from the phone.
        await write_signaling_async(self.session_id, {
            "type": "answer",
            "sdp": self.pc.localDescription.sdp,
            "from": "host",
        })
        logger.info("SDP answer sent to phone")

    async def _handle_ice_candidate(self, candidate_str: str):
        """Add ICE candidate from phone. Parse JSON format from browser."""
        logger.debug("Phone trickle ICE: %s", candidate_str[:120])
        # Phone sends JSON.stringify(candidate.toJSON()), parse it
        try:
            parsed = json.loads(candidate_str) if isinstance(candidate_str, str) else candidate_str
        except (json.JSONDecodeError, TypeError):
            logger.warning("Could not parse ICE candidate: %s", candidate_str)
            return

        # Extract the candidate string that aiortc expects
        candidate_sdp = parsed.get("candidate", "") if isinstance(parsed, dict) else str(parsed)

        if not candidate_sdp:
            logger.debug("Empty ICE candidate (end-of-candidates signal), ignoring")
            return

        if self._remote_description_set and self.pc:
            await self.pc.addIceCandidate(candidate_sdp)
            logger.debug("Added ICE candidate")
        else:
            self._ice_queue.append(candidate_sdp)
            logger.debug("Queued ICE candidate (remote desc not set yet)")

    def _setup_data_channel(self, channel):
        """Wire up data channel message handlers."""

        @channel.on("message")
        def on_message(message):
            # Binary message = raw PCM audio from phone mic
            if isinstance(message, bytes):
                if self._voice_active and self._gemini:
                    # First chunk arrived — cancel the no-audio watchdog. This
                    # beats the race where the chunk lands at t=2.95 s and the
                    # watchdog is about to fire at t=3.0 s.
                    if self._no_audio_watchdog is not None:
                        self._no_audio_watchdog.cancel()
                        self._no_audio_watchdog = None
                    self._last_audio_chunk_ts = time.monotonic()
                    loop = asyncio.get_running_loop()
                    loop.create_task(self._gemini.send_audio(message))
                return

            try:
                data = json.loads(message)
            except json.JSONDecodeError:
                logger.warning("Invalid JSON on data channel: %s", message)
                return

            cmd_type = data.get("type")

            if cmd_type == "tap":
                tap(data["x"], data["y"])

            elif cmd_type == "scroll":
                scroll(data["delta"])

            elif cmd_type == "type":
                type_text(data["text"])

            elif cmd_type == "type-text":
                # Paste via clipboard (instant). Goes through asyncio.Lock so it
                # can't clobber a concurrent get-clipboard read mid-flight.
                # on_before_write tells watcher to ignore our writes right before
                # they happen (both the paste text and the restore of previous).
                loop = asyncio.get_running_loop()
                loop.create_task(type_text_paste_async(
                    data["text"],
                    on_before_write=self._clipboard_watcher.update_last_text,
                ))

            elif cmd_type == "command":
                result = execute_command(data["action"], data.get("payload", {}))
                if result and result != "unknown_action":
                    channel.send(json.dumps({"type": "error", "message": result}))

            elif cmd_type == "voice-start":
                self._voice_mode = data.get("mode", "dictation")
                loop = asyncio.get_running_loop()
                # Hold a handle so _stop_voice can cancel an in-flight start
                # if the user double-taps during the 1s Gemini connect window.
                self._voice_starting_task = loop.create_task(self._start_voice(channel))

            elif cmd_type == "voice-stop":
                reason = data.get("reason", "no-reason")
                logger.info(">>> Received voice-stop from PWA — reason: %s", reason)
                loop = asyncio.get_running_loop()
                loop.create_task(self._stop_voice(channel))

            elif cmd_type == "mic-info":
                # Phone reports actual mic AudioContext rate, channel count, UA.
                # Stash for inclusion in diagnostic logs on next "no-audio" or
                # low-RMS warning — the single most useful field when debugging
                # a user's "no audio" report.
                self._mic_info = {
                    "sampleRate": data.get("sampleRate"),
                    "channelCount": data.get("channelCount"),
                    "userAgent": (data.get("userAgent") or "")[:200],
                }
                logger.info(
                    "mic-info received: sampleRate=%s channelCount=%s UA=%s",
                    self._mic_info["sampleRate"],
                    self._mic_info["channelCount"],
                    self._mic_info["userAgent"],
                )

            # ── Trackpad mode commands ──────────────────────────────

            elif cmd_type == "mousemove":
                mousemove_relative(data["dx"], data["dy"])

            elif cmd_type == "mousedown":
                mousedown()

            elif cmd_type == "mouseup":
                mouseup()

            elif cmd_type == "click":
                click()

            elif cmd_type == "double-click":
                double_click()

            elif cmd_type == "moveto":
                # Move cursor to absolute normalized coords (no click)
                sw, sh = get_screen_size()
                pyautogui.moveTo(
                    max(1, min(int(data["x"] * sw), sw - 1)),
                    max(1, min(int(data["y"] * sh), sh - 1)),
                )

            elif cmd_type == "get-clipboard":
                loop = asyncio.get_running_loop()
                loop.create_task(self._send_clipboard(channel))

            elif cmd_type == "copy-selection":
                loop = asyncio.get_running_loop()
                loop.create_task(self._copy_selection(channel))

            elif cmd_type == "bye":
                loop = asyncio.get_running_loop()
                loop.create_task(self._on_bye())

            else:
                logger.warning("Unknown command type: %s", cmd_type)

        def on_open():
            logger.info("Data channel open")
            # Send screen info to phone
            w, h = get_screen_size()
            channel.send(json.dumps({
                "type": "screen-info",
                "width": w,
                "height": h,
            }))
            # Drain any status payloads that were queued while the channel
            # was still opening (e.g. _start_voice threw before on_open ran).
            if self._pending_status_flushes:
                pending = self._pending_status_flushes
                self._pending_status_flushes = []
                for payload in pending:
                    try:
                        channel.send(json.dumps(payload))
                    except Exception:
                        logger.exception("Failed to drain pending status flush: %s", payload)
            # Start broadcasting cursor position to phone (~20 Hz)
            loop = asyncio.get_running_loop()
            loop.create_task(self._cursor_broadcast_loop(channel))
            # Start clipboard watcher
            self._clipboard_watcher.start()

        channel.on("open", on_open)

        # aiortc fires 'open' before _setup_data_channel runs when the phone
        # creates the channel — the listener above would be attached too late.
        # Call on_open() directly if the channel is already open.
        if channel.readyState == "open":
            on_open()

        @channel.on("close")
        def on_close():
            logger.info("Data channel closed")
            self._clipboard_watcher.stop()
            loop = asyncio.get_running_loop()
            # Clean up any active voice turn first so flush_final runs.
            if self._voice_active:
                loop.create_task(self._stop_voice(channel=None))
            # Then tear down the connection-lifetime Gemini session.
            loop.create_task(self._teardown_gemini())

    def _send_status(self, channel, payload: dict) -> None:
        """Send a voice-status / diagnostic payload, queueing if the channel
        isn't ready.

        Session-lifecycle promotion (2026-04-17): now that pre-warm errors
        can surface before the data channel exists at all (offer-time
        _prewarm_gemini), we MUST queue when channel is None and not drop
        silently. The pending list drains in the data channel's on_open.
        """
        if channel is None or getattr(channel, "readyState", None) != "open":
            self._pending_status_flushes.append(payload)
            return
        try:
            channel.send(json.dumps(payload))
        except Exception:
            logger.exception("Failed to send status payload: %s", payload)
            self._pending_status_flushes.append(payload)

    @staticmethod
    def _classify_start_error(exc: BaseException) -> str:
        """Map a _start_voice exception onto the fixed taxonomy. Keep in sync
        with friendlyMessageFor() in src/hooks/use-voice.ts. Tested in
        host/tests/test_start_voice_error_surfaces.py.

        | reason      | Raised from                                       |
        | ----------- | ------------------------------------------------- |
        | token       | _fetch_hosted_gemini_token (HTTP 4xx/5xx, network)|
        | model       | live.connect() w/ "model"/"not found"/"404"       |
        | handshake   | other live.connect() failure                      |
        | unknown     | catch-all                                          |
        """
        msg = (str(exc) or exc.__class__.__name__).lower()
        # Token errors come from _fetch_hosted_gemini_token as RuntimeError with
        # messages containing "Pro token" / "401" / "network error" / "USER_ID".
        if isinstance(exc, RuntimeError) and any(
            k in msg for k in ("pro token", "401", "403", "network", "user_id", "supabase_service", "gemini_api_key")
        ):
            return "token"
        if any(k in msg for k in ("model", "not found", "404")):
            return "model"
        # Common handshake indicators.
        if any(k in msg for k in ("websocket", "handshake", "connection", "connect")):
            return "handshake"
        return "unknown"

    async def _no_audio_check(self, channel) -> None:
        """3 s after voice-start, if no audio chunk has arrived, the phone's
        mic is dead or permissions were denied. Emit a structured error so the
        PWA can show a toast."""
        try:
            await asyncio.sleep(3.0)
            if not self._voice_active:
                return
            # Race window: first chunk may have arrived between sleep expiring
            # and this line running. Guard with last-chunk-ts too.
            if self._last_audio_chunk_ts > 0:
                return
            logger.warning(
                "No-audio watchdog fired — no PCM in 3s (mic_info=%s)", self._mic_info
            )
            self._send_status(channel, {
                "type": "voice-status",
                "status": "error",
                "reason": "no-audio",
                "detail": "No audio chunks received in 3 seconds",
            })
        except asyncio.CancelledError:
            pass

    async def _mid_session_audio_watchdog(self, channel) -> None:
        """If the PWA's voice-stop is dropped (data channel blip or Android
        PWA swiped away mid-session), chunks just stop arriving. Without this,
        _voice_active stays True forever and the session leaks. Every 2 s we
        check whether the last chunk was >10 s ago; if so, call _stop_voice.
        """
        try:
            while self._voice_active:
                await asyncio.sleep(2.0)
                if not self._voice_active:
                    return
                now = time.monotonic()
                if self._last_audio_chunk_ts == 0:
                    continue  # never seen a chunk yet — no-audio watchdog owns this
                if now - self._last_audio_chunk_ts > 10.0:
                    logger.warning(
                        "Mid-session watchdog: no audio in >10s, auto-stopping voice session"
                    )
                    await self._stop_voice(channel)
                    return
        except asyncio.CancelledError:
            pass

    async def _prewarm_gemini(self):
        """Open the Gemini session at WebRTC-offer time so voice-tap is fast.

        Runs once per connection. Callbacks bind lazily against
        self.data_channel (NOT a captured channel local — the channel doesn't
        exist yet at offer-time). On success, sets _gemini_ready so
        _start_voice can proceed immediately on the first voice-tap.
        """
        prewarm_start_ts = time.monotonic()
        # Idempotency: if a stale session leaked (offer-arrives-twice,
        # ICE re-answer), tear it down first so we don't leak a GeminiLive.
        await self._teardown_gemini()

        # Capture the Event we intend to signal. If teardown later nulls the
        # instance attribute, we can still wake the original waiter.
        ready_event = self._gemini_ready

        host = self

        def on_transcript(text: str, is_final: bool):
            # Phantom-transcript guard: Gemini occasionally emits hallucinated
            # text during the silent pre-warm window before the user's first
            # tap. _turn_counter == 0 means "no voice-tap yet" — drop it.
            if host._gemini is None or host._gemini._turn_counter == 0:
                return

            # Tap-to-first-transcript telemetry. Fires once per turn.
            if host._voice_start_ts is not None and not host._voice_start_logged:
                delta_ms = int((time.monotonic() - host._voice_start_ts) * 1000)
                logger.info("tap-to-first-transcript=%dms", delta_ms)
                host._voice_start_logged = True

            dc = host.data_channel
            if dc is not None and dc.readyState == "open":
                try:
                    dc.send(json.dumps({
                        "type": "stt",
                        "text": text,
                        "is_final": is_final,
                    }))
                except Exception:
                    logger.exception("Failed to forward transcript")

        def on_session_dead():
            if host._voice_active:
                loop = asyncio.get_running_loop()
                loop.create_task(host._restart_gemini(host.data_channel))

        try:
            self._gemini = GeminiLive(
                on_transcript=on_transcript, on_session_dead=on_session_dead,
            )
            await self._gemini.start()
        except Exception as exc:
            reason = self._classify_start_error(exc)
            logger.exception(
                "Gemini pre-warm failed — reason=%s mic_info=%s",
                reason, self._mic_info,
            )
            # Queue the error — data channel is probably still opening.
            # on_open drains _pending_status_flushes and delivers this.
            self._send_status(self.data_channel, {
                "type": "voice-status",
                "status": "error",
                "reason": reason,
                "detail": f"{type(exc).__name__}: {exc}",
            })
            self._gemini = None
        finally:
            self._gemini_prewarm_task = None
            # Always signal ready (success OR failure) so _start_voice's
            # wait_for unblocks immediately. On failure _gemini is None and
            # _start_voice returns without emitting its own timeout error.
            # Use the captured event so a concurrent teardown that nulls
            # self._gemini_ready can't orphan the waiter.
            if ready_event is not None:
                ready_event.set()

        if self._gemini is not None:
            elapsed_ms = int((time.monotonic() - prewarm_start_ts) * 1000)
            logger.info(
                "Gemini pre-warm complete (ready for voice-tap) — %dms", elapsed_ms,
            )

    async def _teardown_gemini(self):
        """Single session-death point. Idempotent — safe to call repeatedly.

        Called from DC on_close, _on_bye, _on_connection_state("closed"|"failed"),
        and _prewarm_gemini on entry (for the offer-arrives-twice case).
        """
        if self._gemini_prewarm_task is not None and not self._gemini_prewarm_task.done():
            self._gemini_prewarm_task.cancel()
            try:
                await self._gemini_prewarm_task
            except (asyncio.CancelledError, Exception):
                pass
        self._gemini_prewarm_task = None

        if self._gemini is None:
            # Preserve _gemini_ready — caller (e.g. _prewarm_gemini's
            # idempotency entry) may have just allocated the Event and is
            # waiting on it. Nulling it here would orphan that waiter.
            return

        try:
            await self._gemini.stop()
        except Exception:
            logger.exception("Gemini.stop() during teardown failed — continuing")
        self._gemini = None
        self._gemini_ready = None
        logger.info("Gemini session torn down (connection-lifetime)")

    async def _start_voice(self, channel):
        """Enter a new turn on the pre-warmed Gemini session.

        Session-lifecycle promotion (2026-04-17): the Gemini session lives for
        the WebRTC connection; this method only opens a new turn via
        begin_turn(). If pre-warm hasn't completed yet (fast double-tap on
        connect), we wait for _gemini_ready. If pre-warm was skipped (flag
        off or never fired), we spawn it inline and await.

        Error taxonomy: "token"/"model"/"handshake"/"unknown". PWA maps these
        to friendly copy via friendlyMessageFor().
        """
        self._voice_active = True
        self._last_audio_chunk_ts = 0.0
        # Tap-to-first-transcript telemetry — stamped now, logged by
        # on_transcript on the first transcript of this turn.
        self._voice_start_ts = time.monotonic()
        self._voice_start_logged = False

        try:
            # Defensive branch: pre-warm flag was off or never fired — fall
            # back to legacy cold-start. _gemini_ready stays None so a second
            # voice-start doesn't wait forever.
            if self._gemini_ready is None:
                logger.info("_start_voice: no pre-warm — spawning inline")
                self._gemini_ready = asyncio.Event()
                loop = asyncio.get_running_loop()
                self._gemini_prewarm_task = loop.create_task(self._prewarm_gemini())

            try:
                await asyncio.wait_for(self._gemini_ready.wait(), timeout=8.0)
            except asyncio.TimeoutError:
                logger.warning("_start_voice: pre-warm didn't complete within 8 s")
                self._send_status(channel, {
                    "type": "voice-status",
                    "status": "error",
                    "reason": "handshake",
                    "detail": "Pre-warm timeout",
                })
                self._voice_active = False
                self._voice_mode = None
                self._voice_start_ts = None
                return

            if self._gemini is None:
                # Pre-warm reported ready but _gemini is None — pre-warm failed
                # and already emitted its own error status. Nothing more to do.
                self._voice_active = False
                self._voice_mode = None
                self._voice_start_ts = None
                return

            # Passive stale-session detection. If the pre-warmed session died
            # idly (GoAway without restart, network blip), begin_turn() raises
            # and we trigger a restart before surfacing the error.
            try:
                await asyncio.wait_for(self._gemini.begin_turn(), timeout=2.0)
            except (RuntimeError, asyncio.TimeoutError) as exc:
                logger.warning(
                    "begin_turn failed (%s) — triggering restart", exc,
                )
                # Fire-and-await restart; subsequent taps warm again.
                try:
                    await self._restart_gemini(channel)
                except Exception:
                    logger.exception("Restart after stale session failed")
                # Surface the handshake error regardless — this tap is lost.
                self._send_status(channel, {
                    "type": "voice-status",
                    "status": "error",
                    "reason": "handshake",
                    "detail": f"Stale session: {type(exc).__name__}",
                })
                self._voice_active = False
                self._voice_mode = None
                self._voice_start_ts = None
                return
        except asyncio.CancelledError:
            # _stop_voice cancelled us mid-pre-warm-wait (user double-tapped).
            logger.info("_start_voice cancelled — double-tap race")
            self._voice_active = False
            self._voice_mode = None
            self._voice_start_ts = None
            raise
        finally:
            self._voice_starting_task = None

        if channel is not None and channel.readyState == "open":
            channel.send(json.dumps({"type": "voice-status", "status": "listening"}))

        # Arm the 3 s no-audio watchdog. Cancelled on first binary chunk.
        loop = asyncio.get_running_loop()
        self._no_audio_watchdog = loop.create_task(self._no_audio_check(channel))
        # Arm the mid-session watchdog so we recover if voice-stop is dropped.
        self._mid_session_watchdog = loop.create_task(self._mid_session_audio_watchdog(channel))

        logger.info(
            "Voice session started (mode=%s mic_info=%s)",
            self._voice_mode, self._mic_info,
        )

    async def _restart_gemini(self, channel):
        """Restart the Gemini session after a drop, preserving accumulated transcript."""
        if not self._voice_active or not self._gemini or self._gemini_restarting:
            return
        self._gemini_restarting = True
        logger.warning("Gemini session died — restarting transparently")
        try:
            await self._gemini.restart()
        except Exception as exc:
            logger.error("Failed to restart Gemini session: %s — voice is dead", exc)
            # Don't leave a zombie — notify PWA that voice stopped
            self._voice_active = False
            self._voice_mode = None
            if channel and channel.readyState == "open":
                channel.send(json.dumps({"type": "voice-status", "status": "idle"}))
            return
        finally:
            self._gemini_restarting = False
        if channel and channel.readyState == "open":
            channel.send(json.dumps({"type": "voice-status", "status": "listening"}))

    async def _stop_voice(self, channel=None):
        """Close the current voice-turn. Does NOT tear down the Gemini session.

        Session-lifecycle promotion (2026-04-17): flush_final() remains the
        only supported voice-stop path (invariant #4). The Gemini session
        survives — _teardown_gemini is the single death point, called only
        from DC close / bye / conn-state-closed.
        """
        self._voice_active = False
        self._voice_mode = None
        # Reset TTF telemetry for per-turn lifecycle symmetry.
        self._voice_start_ts = None
        self._voice_start_logged = False

        # Cancel any in-flight start (user double-tapped during pre-warm wait).
        if self._voice_starting_task is not None and not self._voice_starting_task.done():
            self._voice_starting_task.cancel()
            try:
                await self._voice_starting_task
            except (asyncio.CancelledError, Exception):
                pass
            self._voice_starting_task = None

        # Cancel watchdogs before flushing so they can't fire mid-stop.
        for task_attr in ("_no_audio_watchdog", "_mid_session_watchdog"):
            task = getattr(self, task_attr)
            if task is not None and not task.done():
                task.cancel()
            setattr(self, task_attr, None)

        if self._gemini:
            # Wait for any final transcription still in flight (Cause C).
            try:
                final_text = await self._gemini.flush_final()
            except Exception:
                logger.exception("flush_final failed — falling back to interim_buffer")
                final_text = self._gemini.interim_buffer.strip()
            if final_text and channel and channel.readyState == "open":
                try:
                    channel.send(json.dumps({
                        "type": "stt",
                        "text": final_text,
                        "is_final": True,
                    }))
                except Exception:
                    logger.exception("Failed to send final stt")
            # NOTE: session survives — no .stop(), no self._gemini = None.

        self._send_status(channel, {"type": "voice-status", "status": "idle"})

        logger.info("Voice session stopped (turn ended, Gemini session reused)")

    async def _on_bye(self):
        """Explicit phone-initiated disconnect.

        Called when the phone sends a `bye` command over the data channel
        (user tapped Disconnect in the settings modal). Tears down the PC
        and republishes host-ready immediately, bypassing the 30+ second
        wait for aioice's ICE consent-freshness check to expire. Without
        this, the dashboard shows "Desktop host is offline" right up until
        consent times out, blocking instant reconnects.
        """
        logger.info("Bye received — tearing down and republishing host-ready")
        # Close the current voice turn first so flush_final runs before we
        # pull the Gemini session out from under it.
        if self._voice_active:
            try:
                await self._stop_voice(channel=None)
            except Exception:
                logger.exception("_stop_voice during bye failed")
        # Session teardown — connection is going away.
        await self._teardown_gemini()
        if self.pc:
            try:
                await self.pc.close()
            except Exception:
                logger.exception("Error closing PC on bye")
            self.pc = None
        await update_pc_status_async(self.session_id, "waiting")
        await write_signaling_async(self.session_id, {
            "type": "host-ready",
            "host_id": USER_ID,
            "ice_servers": self._ice_servers_json,
            "turn_status": self._turn_status,
        })

    async def _on_connection_state(self, state: str):
        """Handle PC connectionState transitions.

        Extracted from the inline @pc.on handler so unit tests can drive it
        directly without standing up a real RTCPeerConnection.
        """
        logger.info("Connection state: %s", state)
        if state == "connected":
            await update_pc_status_async(self.session_id, "connected")
        elif state == "disconnected":
            # Transient — WebRTC may self-heal (WiFi jitter, brief packet loss).
            # Don't tear down; let the ICE agent attempt recovery.
            logger.info("Connection disconnected (transient) — waiting for recovery")
        elif state in ("failed", "closed"):
            # Covers abrupt ICE failure where DC on_close may never fire.
            await self._teardown_gemini()
            self._connection_count = getattr(self, '_connection_count', 0) + 1
            if self._connection_count >= getattr(self, '_max_connections', 20):
                logger.info(
                    "Reached %d completed connections — self-restarting for process hygiene "
                    "(Task Scheduler will respawn within 60s)",
                    self._connection_count,
                )
                import os
                os._exit(0)
            await update_pc_status_async(self.session_id, "waiting")
            await write_signaling_async(self.session_id, {
                "type": "host-ready",
                "host_id": USER_ID,
                "ice_servers": self._ice_servers_json,
                "turn_status": self._turn_status,
            })

    async def _copy_selection(self, channel):
        """Fire Ctrl+C and wait for the clipboard to actually update before replying.

        Eliminates the off-by-one race that snapshot+sleep on the phone side
        couldn't fix: pyautogui returns the moment keystrokes are queued, but
        the foreground app may take longer to commit the copy to the clipboard.
        """
        text = await copy_selection_async()
        if channel.readyState == "open":
            channel.send(json.dumps({"type": "clipboard", "text": text}))

    async def _send_clipboard(self, channel):
        """Read PC clipboard (with lock) and send it to the phone."""
        text = await get_clipboard_async()
        if channel.readyState == "open":
            channel.send(json.dumps({"type": "clipboard", "text": text}))

    def _on_clipboard_change(self, text: str):
        """Called from clipboard watcher thread when PC clipboard changes."""
        ch = self.data_channel
        if ch and ch.readyState == "open":
            try:
                ch.send(json.dumps({"type": "clipboard-push", "text": text}))
            except Exception:
                pass  # channel closed between check and send

    async def _cursor_broadcast_loop(self, channel):
        """Broadcasts normalized PC cursor position to phone at ~20 Hz."""
        screen_w, screen_h = get_screen_size()
        if not screen_w or not screen_h:
            return
        while channel.readyState == "open":
            x, y = get_cursor_pos()
            channel.send(json.dumps({
                "type": "cursor-pos",
                "x": round(x / screen_w, 4),
                "y": round(y / screen_h, 4),
            }))
            await asyncio.sleep(0.05)  # 20 Hz

    async def _maintain_turn_credentials(self):
        """Refresh Cloudflare TURN credentials every 12 hours."""
        while self._running:
            await asyncio.sleep(43200)  # 12 hours
            if not self._running:
                break
            ice_servers, status = await _generate_cf_ice_servers()
            self._ice_servers_json = ice_servers
            self._turn_status = status
            # Only rewrite signaling if not connected — avoids firing the phone's
            # Realtime subscription mid-session (which could trigger a spurious reconnect).
            if self.session_id and (not self.pc or self.pc.connectionState != "connected"):
                await write_signaling_async(self.session_id, {
                    "type": "host-ready",
                    "host_id": USER_ID,
                    "ice_servers": self._ice_servers_json,
                    "turn_status": self._turn_status,
                })
            logger.info("TURN credentials refreshed (status=%s)", self._turn_status)

    async def stop(self):
        """Clean shutdown."""
        self._running = False
        self._clipboard_watcher.stop()
        if self._turn_refresh_task:
            self._turn_refresh_task.cancel()
        if self.pc:
            await self.pc.close()
        if self._channel:
            self._channel.cancel()
        if self.session_id:
            await update_pc_status_async(self.session_id, "offline")
        logger.info("WebRTC host stopped")


# Singleton instance
_host: WebRTCHost | None = None


async def start_host():
    """Start the WebRTC host (called from FastAPI startup)."""
    global _host
    _host = WebRTCHost()
    await _host.start()


async def stop_host():
    """Stop the WebRTC host (called from FastAPI shutdown)."""
    global _host
    if _host:
        await _host.stop()
        _host = None
