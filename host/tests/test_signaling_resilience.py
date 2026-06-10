"""
Signaling resilience (2026-06-10).

Observed in production (voicer.log): a Supabase ReadTimeout inside
update_pc_status_async killed _on_bye mid-way, the host-ready republish never
ran, and the dashboard showed "Desktop host is offline" until the host process
restarted. These tests pin the fixes:

  - _on_bye / _on_connection_state treat each Supabase write as independently
    best-effort: a pc_status failure must not skip the host-ready republish
  - the host-ready heartbeat republishes while idle and stays silent while a
    phone is connected or a handshake is in flight

Run: cd host && venv/Scripts/python.exe -m pytest tests/test_signaling_resilience.py -v
"""
from __future__ import annotations

import asyncio

import pytest

import webrtc_host


def _make_host() -> webrtc_host.WebRTCHost:
    host = webrtc_host.WebRTCHost.__new__(webrtc_host.WebRTCHost)
    host.session_id = "test-session-id"
    host._ice_servers_json = None
    host._turn_status = "none"
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
    host._running = True
    host._offer_lock = asyncio.Lock()
    return host


@pytest.fixture
def recorders(monkeypatch):
    pc_status_calls: list[tuple[str, str]] = []
    signaling_writes: list[tuple[str, dict]] = []

    async def fake_update_pc_status(session_id, status):
        pc_status_calls.append((session_id, status))

    async def fake_write_signaling(session_id, payload):
        signaling_writes.append((session_id, payload))

    monkeypatch.setattr(webrtc_host, "update_pc_status_async", fake_update_pc_status)
    monkeypatch.setattr(webrtc_host, "write_signaling_async", fake_write_signaling)
    return pc_status_calls, signaling_writes


@pytest.mark.asyncio
async def test_bye_republishes_host_ready_when_pc_status_write_fails(
    recorders, monkeypatch,
):
    """The exact production failure: ReadTimeout on the pc_status PATCH must
    not prevent the host-ready republish that unblocks reconnection."""
    _, signaling_writes = recorders

    async def exploding_update(session_id, status):
        raise TimeoutError("The read operation timed out")

    monkeypatch.setattr(webrtc_host, "update_pc_status_async", exploding_update)

    host = _make_host()
    await host._on_bye()

    assert len(signaling_writes) == 1
    assert signaling_writes[0][1]["type"] == "host-ready"


@pytest.mark.asyncio
async def test_connection_failed_republishes_when_pc_status_write_fails(
    recorders, monkeypatch,
):
    _, signaling_writes = recorders

    async def exploding_update(session_id, status):
        raise TimeoutError("The read operation timed out")

    monkeypatch.setattr(webrtc_host, "update_pc_status_async", exploding_update)

    host = _make_host()
    await host._on_connection_state("failed")

    assert any(w[1]["type"] == "host-ready" for w in signaling_writes)


@pytest.mark.asyncio
async def test_bye_survives_total_signaling_outage(recorders, monkeypatch):
    """Even if BOTH writes fail, _on_bye must not raise — the heartbeat
    heals the row later."""

    async def explode(*args):
        raise TimeoutError("down")

    monkeypatch.setattr(webrtc_host, "update_pc_status_async", explode)
    monkeypatch.setattr(webrtc_host, "write_signaling_async", explode)

    host = _make_host()
    await host._on_bye()  # must not raise


# ── host-ready heartbeat ─────────────────────────────────────────────────────


async def _run_heartbeat_briefly(host, monkeypatch, cycles: float = 6):
    """Run the heartbeat with sleeps shrunk to ~5 ms for a few cycles."""
    real_sleep = asyncio.sleep
    monkeypatch.setattr(
        webrtc_host.asyncio, "sleep", lambda s: real_sleep(min(s, 0.005))
    )
    task = asyncio.create_task(host._host_ready_heartbeat())
    await real_sleep(0.005 * cycles)
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


@pytest.mark.asyncio
async def test_heartbeat_republishes_while_idle(recorders, monkeypatch):
    pc_status_calls, signaling_writes = recorders
    host = _make_host()
    host.pc = None  # idle — no phone

    await _run_heartbeat_briefly(host, monkeypatch)

    assert any(s == "waiting" for _, s in pc_status_calls), (
        "idle heartbeat must reset pc_status to waiting"
    )
    assert any(w[1]["type"] == "host-ready" for w in signaling_writes)


@pytest.mark.asyncio
async def test_heartbeat_silent_while_connected(recorders, monkeypatch):
    pc_status_calls, signaling_writes = recorders
    host = _make_host()
    host.pc = type("PC", (), {"connectionState": "connected"})()

    await _run_heartbeat_briefly(host, monkeypatch)

    assert pc_status_calls == []
    assert signaling_writes == []


@pytest.mark.asyncio
async def test_heartbeat_silent_during_handshake(recorders, monkeypatch):
    """While _offer_lock is held (offer being answered), the heartbeat must
    not clobber signaling_data mid-exchange."""
    pc_status_calls, signaling_writes = recorders
    host = _make_host()
    host.pc = None

    await host._offer_lock.acquire()
    try:
        await _run_heartbeat_briefly(host, monkeypatch)
    finally:
        host._offer_lock.release()

    assert pc_status_calls == []
    assert signaling_writes == []
