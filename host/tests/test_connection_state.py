"""
Tests for WebRTCHost._on_connection_state — the state-machine bug where
the host gets stuck on `disconnected` and never republishes host-ready,
leaving the phone showing "Desktop host is offline" forever.

Run: cd host && venv/Scripts/python.exe -m pytest tests/test_connection_state.py -v
"""

import sys
from pathlib import Path

import pytest

# Make `host/` importable as if we cd'd into it.
HOST_DIR = Path(__file__).resolve().parents[1]
if str(HOST_DIR) not in sys.path:
    sys.path.insert(0, str(HOST_DIR))

import webrtc_host  # noqa: E402


@pytest.fixture
def host_with_recorder(monkeypatch):
    """Construct a WebRTCHost with supabase I/O replaced by recording stubs."""
    pc_status_calls: list[tuple[str, str]] = []
    signaling_writes: list[tuple[str, dict]] = []

    async def fake_update_pc_status(session_id, status):
        pc_status_calls.append((session_id, status))

    async def fake_write_signaling(session_id, payload):
        signaling_writes.append((session_id, payload))

    monkeypatch.setattr(webrtc_host, "update_pc_status_async", fake_update_pc_status)
    monkeypatch.setattr(webrtc_host, "write_signaling_async", fake_write_signaling)

    # Bypass __init__ — it constructs a ClipboardWatcher which spins a Win32
    # thread. We don't need any of that to test the state handler.
    host = webrtc_host.WebRTCHost.__new__(webrtc_host.WebRTCHost)
    host.session_id = "test-session-id"
    host._ice_servers_json = [{"urls": "stun:stun.l.google.com:19302"}]
    host._turn_status = "none"

    return host, pc_status_calls, signaling_writes


@pytest.mark.asyncio
async def test_connected_state_writes_connected_status(host_with_recorder):
    host, pc_status_calls, signaling_writes = host_with_recorder

    await host._on_connection_state("connected")

    assert pc_status_calls == [("test-session-id", "connected")]
    assert signaling_writes == []


@pytest.mark.asyncio
async def test_failed_state_resets_to_waiting_and_republishes_host_ready(host_with_recorder):
    host, pc_status_calls, signaling_writes = host_with_recorder

    await host._on_connection_state("failed")

    assert pc_status_calls == [("test-session-id", "waiting")]
    assert len(signaling_writes) == 1
    assert signaling_writes[0][1]["type"] == "host-ready"


@pytest.mark.asyncio
async def test_closed_state_resets_to_waiting_and_republishes_host_ready(host_with_recorder):
    host, pc_status_calls, signaling_writes = host_with_recorder

    await host._on_connection_state("closed")

    assert pc_status_calls == [("test-session-id", "waiting")]
    assert signaling_writes[0][1]["type"] == "host-ready"


@pytest.mark.asyncio
async def test_disconnected_state_currently_does_nothing(host_with_recorder):
    """Captures the bug: on `disconnected`, the host writes NOTHING.

    This is the state the phone leaves the host in when it backgrounds or
    the PWA is swiped away. Because the host never escalates `disconnected`
    to `failed`, pc_status stays "connected" and signaling_data stays
    {type:"answer"} forever. On reconnect, the dashboard reads those stale
    values and renders "Desktop host is offline".

    This test passes with the CURRENT buggy code and will FAIL once we add
    the recovery timer — at which point we invert the assertion.
    """
    host, pc_status_calls, signaling_writes = host_with_recorder

    await host._on_connection_state("disconnected")

    assert pc_status_calls == []
    assert signaling_writes == []


@pytest.mark.asyncio
async def test_bye_immediately_resets_to_waiting_and_republishes_host_ready(host_with_recorder):
    """Explicit phone-initiated disconnect must not wait for ICE consent expiry.

    When the user taps "Disconnect" in the settings modal, the phone sends a
    `bye` command over the data channel. The host must tear down its PC and
    republish host-ready immediately, so the dashboard shows the host as ready
    for an instant reconnect (instead of sitting on a stale pc_status=connected
    row for 30+ seconds until aioice notices consent expired).
    """
    host, pc_status_calls, signaling_writes = host_with_recorder

    close_called: list[bool] = []

    class FakePC:
        async def close(self):
            close_called.append(True)

    host.pc = FakePC()

    await host._on_bye()

    assert close_called == [True], "bye must close the PC immediately"
    assert pc_status_calls == [("test-session-id", "waiting")]
    assert len(signaling_writes) == 1
    assert signaling_writes[0][1]["type"] == "host-ready"


@pytest.mark.asyncio
async def test_bye_without_active_pc_still_republishes(host_with_recorder):
    """If no PC is alive (e.g. host just booted), bye is still idempotent."""
    host, pc_status_calls, signaling_writes = host_with_recorder
    host.pc = None

    await host._on_bye()

    assert pc_status_calls == [("test-session-id", "waiting")]
    assert signaling_writes[0][1]["type"] == "host-ready"


@pytest.mark.asyncio
async def test_sequence_connected_then_disconnected_leaves_pc_status_connected(host_with_recorder):
    """End-to-end of the bug: phone connects, backgrounds, returns — and
    the Supabase row still thinks the session is healthy.
    """
    host, pc_status_calls, signaling_writes = host_with_recorder

    await host._on_connection_state("connected")
    await host._on_connection_state("disconnected")

    # pc_status was set to "connected" and never reset
    assert pc_status_calls == [("test-session-id", "connected")]
    # signaling was never touched — the phone's dashboard will read a stale
    # {type:"answer"} row and show "Desktop host is offline"
    assert signaling_writes == []
