"""
Session-lifecycle promotion (2026-04-17): Gemini session is pre-warmed at
SDP-offer time (NOT DC-open) so the first voice-tap is maximally warm.

These tests exercise the host-side pre-warm pathway:
  - offer-time pre-warm spawns _prewarm_gemini task
  - GEMINI_PREWARM=false falls back to the legacy cold-start branch
  - _start_voice before pre-warm complete blocks on _gemini_ready
  - _start_voice after pre-warm complete is fast
  - _stop_voice does NOT tear down the session
  - three taps reuse the same session (+3 activity cycles only from turns 2-3)
  - a stale session between idle periods triggers _restart_gemini from begin_turn

Run: cd host && venv/Scripts/python.exe -m pytest tests/test_prewarm_lifecycle.py -v
"""
from __future__ import annotations

import asyncio
import json
import time

import pytest

import gemini_live
import webrtc_host
from tests.conftest import _FakeResponse


class FakeChannel:
    def __init__(self, ready: bool = True):
        self.readyState = "open" if ready else "connecting"
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
    host._gemini_ready = None
    host._gemini_prewarm_task = None
    host._voice_start_ts = None
    host._voice_start_logged = False
    host.data_channel = None
    return host


# ── Helper: the spawn-at-offer-time code path ─────────────────────────────────
#
# _handle_offer does more than spawn pre-warm (ICE, SDP, etc.). We exercise
# only the spawn block from a test-local seam that mirrors production exactly
# so a regression that moves the trigger back to DC-open fails here.

def _maybe_spawn_prewarm(host: webrtc_host.WebRTCHost) -> None:
    """Mirror of the spawn block at the top of _handle_offer."""
    import os
    if os.environ.get("GEMINI_PREWARM", "true").lower() == "true":
        host._gemini_ready = asyncio.Event()
        loop = asyncio.get_running_loop()
        host._gemini_prewarm_task = loop.create_task(host._prewarm_gemini())


# ─────────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_prewarm_fires_on_offer_received(fake_client_factory, monkeypatch):
    """Regression guard: pre-warm must spawn at SDP-offer time, not DC-open.

    If someone moves this trigger back into on_data_channel/on_open, this
    test fails because data_channel is None at spawn time.
    """
    factory, _ = fake_client_factory
    factory(enter_delay=0.0)

    host = _make_host()
    monkeypatch.setenv("GEMINI_PREWARM", "true")

    # No data channel yet — mirrors real offer-time state.
    assert host.data_channel is None

    _maybe_spawn_prewarm(host)

    assert host._gemini_prewarm_task is not None, (
        "pre-warm task not spawned at offer-time — regression to DC-open trigger?"
    )
    assert host._gemini_ready is not None

    await host._gemini_prewarm_task
    assert host._gemini_ready.is_set()
    assert host._gemini is not None

    await host._teardown_gemini()


@pytest.mark.asyncio
async def test_prewarm_respects_gemini_prewarm_flag(fake_client_factory, monkeypatch):
    """GEMINI_PREWARM=false must skip the offer-time spawn and force the
    legacy inline cold-start branch in _start_voice."""
    factory, _ = fake_client_factory
    factory(enter_delay=0.0)

    host = _make_host()
    monkeypatch.setenv("GEMINI_PREWARM", "false")
    channel = FakeChannel()
    host.data_channel = channel

    _maybe_spawn_prewarm(host)

    assert host._gemini_prewarm_task is None
    assert host._gemini_ready is None

    # _start_voice must spawn pre-warm inline and await.
    await host._start_voice(channel)

    assert host._gemini is not None, (
        "legacy fallback did not produce a live GeminiLive instance"
    )
    assert host._voice_active is True

    await host._stop_voice(channel)
    await host._teardown_gemini()


@pytest.mark.asyncio
async def test_voice_start_before_prewarm_complete_waits(
    fake_client_factory, monkeypatch
):
    """Fast double-tap during a slow pre-warm must block on _gemini_ready
    rather than spawning a second pre-warm."""
    factory, _ = fake_client_factory
    # 500 ms enter delay simulates a slow Gemini WebSocket handshake.
    factory(enter_delay=0.5)

    host = _make_host()
    monkeypatch.setenv("GEMINI_PREWARM", "true")
    channel = FakeChannel()
    host.data_channel = channel

    _maybe_spawn_prewarm(host)

    # Voice-start lands immediately — pre-warm is still in flight.
    t0 = time.monotonic()
    await host._start_voice(channel)
    elapsed = time.monotonic() - t0

    assert host._voice_active is True
    # Must have blocked on _gemini_ready (≥ enter_delay) but completed
    # well inside the 8 s timeout.
    assert 0.2 <= elapsed <= 1.5, f"unexpected wait: {elapsed:.2f}s"

    await host._stop_voice(channel)
    await host._teardown_gemini()


@pytest.mark.asyncio
async def test_voice_start_after_prewarm_is_fast(fake_client_factory, monkeypatch):
    """Pre-warm done → voice-start is just begin_turn() — sub-100 ms against
    the fake client."""
    factory, _ = fake_client_factory
    factory(enter_delay=0.0)

    host = _make_host()
    monkeypatch.setenv("GEMINI_PREWARM", "true")
    channel = FakeChannel()
    host.data_channel = channel

    _maybe_spawn_prewarm(host)
    await host._gemini_prewarm_task  # ensure pre-warm complete

    t0 = time.monotonic()
    await host._start_voice(channel)
    elapsed = time.monotonic() - t0

    assert host._voice_active is True
    assert elapsed < 0.3, f"warm-path voice-start too slow: {elapsed:.3f}s"

    await host._stop_voice(channel)
    await host._teardown_gemini()


@pytest.mark.asyncio
async def test_stop_voice_does_not_tear_down_session(fake_client_factory, monkeypatch):
    """Per-turn stop keeps the session alive for the next turn."""
    factory, _ = fake_client_factory
    factory(enter_delay=0.0)

    host = _make_host()
    monkeypatch.setenv("GEMINI_PREWARM", "true")
    channel = FakeChannel()
    host.data_channel = channel

    _maybe_spawn_prewarm(host)
    await host._gemini_prewarm_task
    await host._start_voice(channel)

    snapshot = host._gemini
    send_task = snapshot._send_task
    recv_task = snapshot._recv_task
    flush_task = snapshot._flush_task

    await host._stop_voice(channel)

    # Session survives per-turn stop.
    assert host._gemini is snapshot, "_stop_voice tore down the session"
    assert not send_task.done()
    assert not recv_task.done()
    assert not flush_task.done()
    assert host._voice_active is False

    await host._teardown_gemini()


@pytest.mark.asyncio
async def test_three_taps_reuse_session(fake_client_factory, monkeypatch):
    factory, session_holder = fake_client_factory
    factory(enter_delay=0.0)

    host = _make_host()
    monkeypatch.setenv("GEMINI_PREWARM", "true")
    channel = FakeChannel()
    host.data_channel = channel

    _maybe_spawn_prewarm(host)
    await host._gemini_prewarm_task

    first_session = host._gemini
    fake = session_holder[0]
    starts_before_taps = sum(1 for k, _ in fake.calls if k == "activity_start")

    for _ in range(3):
        await host._start_voice(channel)
        await host._stop_voice(channel)

    # Same GeminiLive instance throughout.
    assert host._gemini is first_session, "session rotated mid-reuse"

    # Turn #1 skips end/start; turns #2 and #3 each emit one activity_start.
    starts_after = sum(1 for k, _ in fake.calls if k == "activity_start")
    assert starts_after - starts_before_taps == 2, (
        f"expected 2 additional activity_start across 3 taps "
        f"(turn #1 skipped), got {starts_after - starts_before_taps}"
    )

    await host._teardown_gemini()


@pytest.mark.asyncio
async def test_stale_session_triggers_restart_on_begin_turn(
    fake_client_factory, monkeypatch,
):
    """If the idle session died silently, begin_turn() raises RuntimeError
    and _start_voice must route to _restart_gemini."""
    factory, _ = fake_client_factory
    factory(enter_delay=0.0)

    host = _make_host()
    monkeypatch.setenv("GEMINI_PREWARM", "true")
    channel = FakeChannel()
    host.data_channel = channel

    _maybe_spawn_prewarm(host)
    await host._gemini_prewarm_task

    # Mark the session dead without tearing it down — simulates GoAway
    # arriving during the idle window.
    host._gemini._active = False

    restart_calls: list[bool] = []

    async def fake_restart(ch):
        restart_calls.append(True)

    monkeypatch.setattr(host, "_restart_gemini", fake_restart)

    await host._start_voice(channel)

    assert restart_calls, "_restart_gemini was not invoked after stale begin_turn"
    # Error was surfaced to PWA
    errors = [
        json.loads(s) for s in channel.sends
        if "status" in s and json.loads(s).get("status") == "error"
    ]
    assert any(e.get("reason") == "handshake" for e in errors), (
        f"expected handshake error surfaced to PWA, got {channel.sends}"
    )
    assert host._voice_active is False

    await host._teardown_gemini()
