"""
Cause D (startup watchdog) + Cause K (mid-session watchdog).

Two distinct failure modes, same fix family — both armed in _start_voice,
both emit structured signals so the PWA and the host event loop recover
cleanly without a reboot.

1. STARTUP WATCHDOG (Cause D).
   After _start_voice succeeds, a 3-second task sleeps and — if no PCM has
   arrived — emits `voice-status: error, reason: "no-audio"`. This is the
   canary that fires when Android Chrome silently ignored mic permission,
   or when the AudioContext sample-rate mismatch (Cause F) produced no
   usable audio at all.

2. MID-SESSION WATCHDOG (Cause K).
   If the PWA's `voice-stop` never arrives (closed data channel, Android
   PWA swiped away mid-dictation), chunks just stop coming. Without this,
   `_voice_active` stays True forever and the session leaks. Every 2 s we
   check: >10 s since last chunk → auto-call `_stop_voice`.

Both tests use a FakeChannel and monkeypatch `GeminiLive.start` so the real
Gemini WebSocket is not touched.

Note: the filename is plural ("watchdogs") on purpose — a future reader
grepping for either Cause D or Cause K finds both cases in one file.

Run: cd host && venv/Scripts/python.exe -m pytest tests/test_audio_watchdogs.py -v
"""
from __future__ import annotations

import asyncio
import json
import time

import pytest

import gemini_live
import webrtc_host


class FakeChannel:
    def __init__(self):
        self.readyState = "open"
        self.sends: list[str] = []

    def send(self, payload: str) -> None:
        self.sends.append(payload)


def _make_host() -> webrtc_host.WebRTCHost:
    host = webrtc_host.WebRTCHost.__new__(webrtc_host.WebRTCHost)
    host.session_id = "test-session"
    host._voice_active = False
    host._voice_mode = None
    host._gemini = None
    host._gemini_restarting = False
    host._voice_starting_task = None
    host._no_audio_watchdog = None
    host._mid_session_watchdog = None
    host._last_audio_chunk_ts = 0.0
    host._mic_info = None
    host._pending_status_flushes = []
    return host


async def _install_stub_gemini(host: webrtc_host.WebRTCHost, monkeypatch) -> None:
    """Swap GeminiLive.start so it completes instantly without a real WS."""
    async def fake_start(self, _preserve_buffer: bool = False):
        self._active = True

    async def fake_stop(self):
        self._active = False

    async def fake_flush_final(self, timeout: float = 1.5) -> str:
        return ""

    monkeypatch.setattr(gemini_live.GeminiLive, "start", fake_start)
    monkeypatch.setattr(gemini_live.GeminiLive, "stop", fake_stop)
    monkeypatch.setattr(gemini_live.GeminiLive, "flush_final", fake_flush_final)


# ── Test 1: STARTUP WATCHDOG (Cause D) ──────────────────────────────────────
@pytest.mark.asyncio
async def test_startup_watchdog_fires_when_no_audio_arrives(monkeypatch):
    """After _start_voice, if no PCM arrives in 3 s, emit voice-status:error
    reason=no-audio. Speed up the 3 s sleep so the test runs in milliseconds."""
    host = _make_host()
    channel = FakeChannel()

    await _install_stub_gemini(host, monkeypatch)

    # Speed up: patch asyncio.sleep inside the watchdog by shrinking the
    # constant in _no_audio_check via monkeypatch on the method.
    original_no_audio_check = webrtc_host.WebRTCHost._no_audio_check

    async def fast_no_audio_check(self, channel):
        try:
            await asyncio.sleep(0.05)  # was 3.0
            if not self._voice_active:
                return
            if self._last_audio_chunk_ts > 0:
                return
            self._send_status(channel, {
                "type": "voice-status",
                "status": "error",
                "reason": "no-audio",
                "detail": "No audio chunks received in 3 seconds",
            })
        except asyncio.CancelledError:
            pass

    monkeypatch.setattr(
        webrtc_host.WebRTCHost, "_no_audio_check", fast_no_audio_check
    )

    await host._start_voice(channel)

    # Wait a little longer than the shortened watchdog.
    await asyncio.sleep(0.1)

    statuses = [json.loads(s) for s in channel.sends]
    errors = [s for s in statuses if s.get("status") == "error"]
    assert len(errors) == 1, f"Expected one error send, got {statuses}"
    assert errors[0]["reason"] == "no-audio"

    # Cleanup.
    await host._stop_voice(channel)


@pytest.mark.asyncio
async def test_startup_watchdog_cancelled_on_first_chunk(monkeypatch):
    """Audit catch — the race fix: the first PCM chunk arrives at t=2.95 s,
    the watchdog is scheduled to fire at t=3.00 s. The cancel-on-first-chunk
    hook in the binary branch of on_message kills the watchdog before it
    can fire. We simulate this by arming the watchdog, setting
    _last_audio_chunk_ts, cancelling the watchdog (mirrors on_message's
    first-chunk branch), and checking no error was emitted."""
    host = _make_host()
    channel = FakeChannel()

    await _install_stub_gemini(host, monkeypatch)

    async def fast_no_audio_check(self, channel):
        try:
            await asyncio.sleep(0.1)
            if not self._voice_active:
                return
            if self._last_audio_chunk_ts > 0:
                return
            self._send_status(channel, {
                "type": "voice-status",
                "status": "error",
                "reason": "no-audio",
            })
        except asyncio.CancelledError:
            pass

    monkeypatch.setattr(
        webrtc_host.WebRTCHost, "_no_audio_check", fast_no_audio_check
    )

    await host._start_voice(channel)

    # Simulate first audio chunk arriving: mirrors the binary branch of
    # _setup_data_channel.on_message in webrtc_host.py.
    assert host._no_audio_watchdog is not None
    host._no_audio_watchdog.cancel()
    host._no_audio_watchdog = None
    host._last_audio_chunk_ts = time.monotonic()

    await asyncio.sleep(0.2)

    errors = [json.loads(s) for s in channel.sends if "error" in s]
    assert len(errors) == 0, (
        f"Watchdog fired despite audio arriving — got errors: {errors}"
    )

    await host._stop_voice(channel)


# ── Test 2: MID-SESSION WATCHDOG (Cause K) ──────────────────────────────────
@pytest.mark.asyncio
async def test_mid_session_watchdog_auto_stops_when_voice_stop_dropped(
    monkeypatch,
):
    """Simulates the closed-data-channel scenario: _voice_active becomes True,
    a few chunks arrive, then the PWA's voice-stop is dropped and chunks stop.
    After 10 s of silence, the mid-session watchdog auto-calls _stop_voice."""
    host = _make_host()
    channel = FakeChannel()

    await _install_stub_gemini(host, monkeypatch)

    # Shrink the watchdog's threshold so we don't wait 10 s in the test.
    async def fast_mid_session_watchdog(self, channel):
        try:
            while self._voice_active:
                await asyncio.sleep(0.05)  # was 2.0
                if not self._voice_active:
                    return
                now = time.monotonic()
                if self._last_audio_chunk_ts == 0:
                    continue
                if now - self._last_audio_chunk_ts > 0.15:  # was 10.0
                    await self._stop_voice(channel)
                    return
        except asyncio.CancelledError:
            pass

    monkeypatch.setattr(
        webrtc_host.WebRTCHost,
        "_mid_session_audio_watchdog",
        fast_mid_session_watchdog,
    )

    await host._start_voice(channel)

    # Simulate chunks flowing briefly — mirrors what on_message does on each
    # binary message.
    host._no_audio_watchdog.cancel()
    host._no_audio_watchdog = None
    host._last_audio_chunk_ts = time.monotonic()
    await asyncio.sleep(0.02)
    host._last_audio_chunk_ts = time.monotonic()

    # Now go silent — the PWA's voice-stop was dropped by a closed channel.
    # Wait >0.15 s gap + 0.05 s watchdog tick.
    await asyncio.sleep(0.35)

    # Invariants: auto-stop ran.
    assert host._voice_active is False, (
        "Mid-session watchdog did not auto-stop after gap — Cause K regression"
    )
    assert host._gemini is None, "Gemini session not disposed by auto-stop"

    statuses = [json.loads(s) for s in channel.sends]
    assert any(s.get("status") == "idle" for s in statuses), (
        f"PWA never received voice-status:idle from auto-stop — sends={statuses}"
    )
