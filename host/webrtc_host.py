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
    type_text_paste_async, get_clipboard_async,
)
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
)

logger = logging.getLogger(__name__)


def _build_rtc_config() -> RTCConfiguration:
    """Build RTCConfiguration with STUN always on, TURN from .env if set."""
    ice_servers = [
        RTCIceServer(urls=["stun:stun.l.google.com:19302"]),
        RTCIceServer(urls=["stun:stun1.l.google.com:19302"]),
    ]
    turn_url = os.environ.get("TURN_URL")
    if turn_url:
        ice_servers.append(RTCIceServer(
            urls=[turn_url],
            username=os.environ.get("TURN_USERNAME", ""),
            credential=os.environ.get("TURN_CREDENTIAL", ""),
        ))
        logger.info("TURN server configured: %s", turn_url)
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

        # Clipboard watcher (pushes PC clipboard changes to phone)
        self._clipboard_watcher = ClipboardWatcher(callback=self._on_clipboard_change)

        # Subscription blocked flag (checked on start, rechecked on connect)
        self._subscription_blocked: bool = False

    async def start(self):
        """Boot up: upsert session, subscribe to signaling, wait for offer."""
        try:
            self._subscription_blocked = await check_subscription_blocked_async()
            logger.info("Subscription blocked: %s", self._subscription_blocked)
        except Exception:
            logger.warning("Could not check subscription, allowing connection")
            self._subscription_blocked = False

        self.session_id = await upsert_session_async()
        self._running = True

        # Subscribe to Realtime for signaling (now async, returns a task)
        self._channel = await subscribe_signaling(
            self.session_id, self._on_signaling_data
        )

        screen_w, screen_h = get_screen_size()
        logger.info(
            "Host ready. Session: %s, Screen: %dx%d. Waiting for phone offer...",
            self.session_id, screen_w, screen_h,
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

        # Clean up any previous connection
        if self.pc:
            await self.pc.close()

        rtc_config = _build_rtc_config()
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
            state = self.pc.connectionState
            logger.info("Connection state: %s", state)
            if state == "connected":
                await update_pc_status_async(self.session_id, "connected")
            elif state == "disconnected":
                # Transient — WebRTC may self-heal (WiFi jitter, brief packet loss).
                # Don't tear down; let the ICE agent attempt recovery.
                logger.info("Connection disconnected (transient) — waiting for recovery")
            elif state in ("failed", "closed"):
                await update_pc_status_async(self.session_id, "waiting")
                # Reset to host-ready for reconnection
                await write_signaling_async(self.session_id, {
                    "type": "host-ready",
                    "host_id": USER_ID,
                })

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
                loop.create_task(self._start_voice(channel))

            elif cmd_type == "voice-stop":
                loop = asyncio.get_running_loop()
                loop.create_task(self._stop_voice(channel))

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
            # Clean up any active voice session on disconnect
            if self._voice_active:
                loop = asyncio.get_running_loop()
                loop.create_task(self._stop_voice(channel=None))

    async def _start_voice(self, channel):
        """Start a Gemini Live STT session."""
        self._voice_active = True

        def on_transcript(text: str, is_final: bool):
            """Forward transcription to phone over data channel."""
            if channel.readyState == "open":
                channel.send(json.dumps({
                    "type": "stt",
                    "text": text,
                    "is_final": is_final,
                }))

        def on_session_dead():
            """Gemini WebSocket dropped — restart transparently."""
            if self._voice_active:
                loop = asyncio.get_running_loop()
                loop.create_task(self._restart_gemini(channel))

        self._gemini = GeminiLive(on_transcript=on_transcript, on_session_dead=on_session_dead)
        await self._gemini.start()

        if channel.readyState == "open":
            channel.send(json.dumps({"type": "voice-status", "status": "listening"}))

        logger.info("Voice session started (mode=%s)", self._voice_mode)

    async def _restart_gemini(self, channel):
        """Restart the Gemini session after a drop, preserving accumulated transcript."""
        if not self._voice_active or not self._gemini or self._gemini_restarting:
            return
        self._gemini_restarting = True
        logger.warning("Gemini session died — restarting transparently")
        try:
            await self._gemini.restart()
        except Exception as exc:
            logger.error("Failed to restart Gemini session: %s", exc)
            return
        finally:
            self._gemini_restarting = False
        if channel.readyState == "open":
            channel.send(json.dumps({"type": "voice-status", "status": "listening"}))

    async def _stop_voice(self, channel=None):
        """Stop the active Gemini Live session and flush final transcript."""
        self._voice_active = False
        self._voice_mode = None

        if self._gemini:
            # Flush accumulated ASR buffer as is_final=True — no waiting needed
            final_text = self._gemini.interim_buffer.strip()
            if final_text and channel and channel.readyState == "open":
                channel.send(json.dumps({
                    "type": "stt",
                    "text": final_text,
                    "is_final": True,
                }))
            await self._gemini.stop()
            self._gemini = None

        if channel and channel.readyState == "open":
            channel.send(json.dumps({"type": "voice-status", "status": "idle"}))

        logger.info("Voice session stopped")

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

    async def stop(self):
        """Clean shutdown."""
        self._running = False
        self._clipboard_watcher.stop()
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
