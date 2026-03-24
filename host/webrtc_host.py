"""
WebRTC host — streams desktop screen to phone and receives commands via data channel.

The host is NOT the caller. It waits for an SDP offer from the phone (via Supabase
Realtime), then responds with an SDP answer. The phone creates the data channel.
"""

import asyncio
import json
import logging
import time
from fractions import Fraction

import mss
import numpy as np
from PIL import Image
from aiortc import RTCPeerConnection, RTCSessionDescription
from aiortc.contrib.media import MediaStreamTrack
import av

from input import tap, type_text, scroll, execute_command
from screen import get_screen_size
from supabase_client import (
    upsert_session,
    write_signaling,
    update_pc_status,
    subscribe_signaling,
    USER_ID,
)

logger = logging.getLogger(__name__)

# Target resolution for streaming (downscale from native)
STREAM_WIDTH = 1280
STREAM_HEIGHT = 720
TARGET_FPS = 15


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

    async def start(self):
        """Boot up: upsert session, subscribe to signaling, wait for offer."""
        self.session_id = upsert_session()
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
                write_signaling(self.session_id, {
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
        # Clean up any previous connection
        if self.pc:
            await self.pc.close()

        self.pc = RTCPeerConnection()
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
                update_pc_status(self.session_id, "connected")
            elif state in ("failed", "closed", "disconnected"):
                update_pc_status(self.session_id, "waiting")
                # Reset to host-ready for reconnection
                write_signaling(self.session_id, {
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

        # Send answer to phone via Supabase
        write_signaling(self.session_id, {
            "type": "answer",
            "sdp": self.pc.localDescription.sdp,
            "from": "host",
        })
        logger.info("SDP answer sent to phone")

    async def _handle_ice_candidate(self, candidate_str: str):
        """Add ICE candidate from phone. Parse JSON format from browser."""
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
            try:
                data = json.loads(message) if isinstance(message, str) else message
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

            elif cmd_type == "command":
                result = execute_command(data["action"], data.get("payload", {}))
                if result:
                    channel.send(json.dumps({"type": "error", "message": result}))

            else:
                logger.warning("Unknown command type: %s", cmd_type)

        @channel.on("open")
        def on_open():
            logger.info("Data channel open")
            # Send screen info to phone
            w, h = get_screen_size()
            channel.send(json.dumps({
                "type": "screen-info",
                "width": w,
                "height": h,
            }))

        @channel.on("close")
        def on_close():
            logger.info("Data channel closed")

    async def stop(self):
        """Clean shutdown."""
        self._running = False
        if self.pc:
            await self.pc.close()
        if self._channel:
            self._channel.cancel()
        if self.session_id:
            update_pc_status(self.session_id, "offline")
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
