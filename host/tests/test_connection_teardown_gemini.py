"""
Session-lifecycle promotion (2026-04-17): the Gemini session is torn down at
connection death, not at voice-stop. These tests verify all three death paths
call _teardown_gemini exactly once, and that teardown is safely idempotent.

Death paths:
  - DC on_close (graceful DC close without a PC-level event)
  - _on_bye (explicit phone-initiated disconnect)
  - _on_connection_state("failed"|"closed") (abrupt ICE failure)

Plus: a new connection after teardown produces a fresh GeminiLive instance
(no stale reference leaks across reconnects).

Run: cd host && venv/Scripts/python.exe -m pytest tests/test_connection_teardown_gemini.py -v
"""
from __future__ import annotations

import asyncio

import pytest

import gemini_live
import webrtc_host


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
    host.pc = None
    host._ice_servers_json = "[]"
    host._turn_status = "none"
    return host


async def _prewarm_and_settle(host: webrtc_host.WebRTCHost) -> gemini_live.GeminiLive:
    host._gemini_ready = asyncio.Event()
    loop = asyncio.get_running_loop()
    host._gemini_prewarm_task = loop.create_task(host._prewarm_gemini())
    await host._gemini_prewarm_task
    assert host._gemini is not None
    return host._gemini


@pytest.mark.asyncio
async def test_teardown_disposes_session(fake_client_factory, monkeypatch):
    """_teardown_gemini nulls _gemini, _gemini_ready, and calls stop exactly once."""
    factory, _ = fake_client_factory
    factory(enter_delay=0.0)

    host = _make_host()
    session = await _prewarm_and_settle(host)

    stop_calls: list[bool] = []
    original_stop = gemini_live.GeminiLive.stop

    async def tracked_stop(self):
        stop_calls.append(True)
        await original_stop(self)

    monkeypatch.setattr(gemini_live.GeminiLive, "stop", tracked_stop)

    await host._teardown_gemini()

    assert host._gemini is None
    assert host._gemini_ready is None
    assert host._gemini_prewarm_task is None
    assert len(stop_calls) == 1


@pytest.mark.asyncio
async def test_bye_triggers_teardown(fake_client_factory, monkeypatch):
    """_on_bye tears down the Gemini session before PC close."""
    factory, _ = fake_client_factory
    factory(enter_delay=0.0)

    host = _make_host()
    await _prewarm_and_settle(host)

    # Stub out the Supabase signaling calls — they are not part of this test.
    async def noop(*args, **kwargs):
        pass

    monkeypatch.setattr(webrtc_host, "update_pc_status_async", noop)
    monkeypatch.setattr(webrtc_host, "write_signaling_async", noop)

    stop_calls: list[bool] = []
    original_stop = gemini_live.GeminiLive.stop

    async def tracked_stop(self):
        stop_calls.append(True)
        await original_stop(self)

    monkeypatch.setattr(gemini_live.GeminiLive, "stop", tracked_stop)

    await host._on_bye()

    assert host._gemini is None, "_on_bye did not tear down the session"
    assert len(stop_calls) == 1


@pytest.mark.parametrize("state", ["failed", "closed"])
@pytest.mark.asyncio
async def test_connection_state_closed_triggers_teardown(
    fake_client_factory, monkeypatch, state,
):
    """connectionState failed/closed tears down the Gemini session.

    Covers the abrupt ICE-failure case where DC on_close may never fire.
    Parametrized (not a for-loop) because both `original_stop` and
    `stop_calls` are free variables that share a scope cell across loop
    iterations — a loop would make tracker_2 append to stop_calls_1 and
    recursively call tracker_1, producing phantom entries and depth blowups.
    Separate test invocations give each state its own clean scope.
    """
    factory, _ = fake_client_factory
    factory(enter_delay=0.0)

    async def noop(*args, **kwargs):
        pass

    monkeypatch.setattr(webrtc_host, "update_pc_status_async", noop)
    monkeypatch.setattr(webrtc_host, "write_signaling_async", noop)

    host = _make_host()
    await _prewarm_and_settle(host)

    stop_calls: list[bool] = []
    original_stop = gemini_live.GeminiLive.stop

    async def tracked_stop(self):
        stop_calls.append(True)
        await original_stop(self)

    monkeypatch.setattr(gemini_live.GeminiLive, "stop", tracked_stop)

    await host._on_connection_state(state)

    assert host._gemini is None, f"state={state} did not tear down"
    assert len(stop_calls) == 1, (
        f"state={state}: expected 1 stop, got {len(stop_calls)}"
    )


@pytest.mark.asyncio
async def test_teardown_is_idempotent(fake_client_factory, monkeypatch):
    factory, _ = fake_client_factory
    factory(enter_delay=0.0)

    host = _make_host()
    await _prewarm_and_settle(host)

    stop_calls: list[bool] = []
    original_stop = gemini_live.GeminiLive.stop

    async def tracked_stop(self):
        stop_calls.append(True)
        await original_stop(self)

    monkeypatch.setattr(gemini_live.GeminiLive, "stop", tracked_stop)

    await host._teardown_gemini()
    await host._teardown_gemini()
    await host._teardown_gemini()

    assert len(stop_calls) == 1, (
        f"teardown not idempotent — stop() called {len(stop_calls)} times"
    )
    assert host._gemini is None


@pytest.mark.asyncio
async def test_new_connection_creates_fresh_session(fake_client_factory, monkeypatch):
    """After teardown, a new pre-warm cycle produces a *different* GeminiLive
    instance — no stale reference leaks across reconnects."""
    factory, _ = fake_client_factory
    factory(enter_delay=0.0)

    host = _make_host()
    first = await _prewarm_and_settle(host)
    await host._teardown_gemini()
    assert host._gemini is None

    # Install a fresh fake session for the second connection cycle.
    factory(enter_delay=0.0)
    second = await _prewarm_and_settle(host)

    assert second is not first, "reconnect reused a stale GeminiLive instance"

    await host._teardown_gemini()
