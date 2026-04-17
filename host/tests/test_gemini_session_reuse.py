"""
Session-lifecycle promotion (2026-04-17): GeminiLive now lives for the entire
WebRTC connection, not a single voice-tap. begin_turn() runs per-tap to reset
per-turn state and cycle the activity window without tearing the session down.

These tests exercise:
  - session identity is stable across turns
  - per-turn state resets, session-lifetime counters accumulate
  - turn #1 skips the redundant activity_end/activity_start (start() already
    opened the window during pre-warm)
  - begin_turn() on a dead session raises so the caller can route to restart
  - flush_final does not kill the background tasks
  - begin_turn() blocks on an in-flight restart (restart-collision guard)

Run: cd host && venv/Scripts/python.exe -m pytest tests/test_gemini_session_reuse.py -v
"""
from __future__ import annotations

import asyncio

import pytest

import gemini_live
from tests.conftest import _FakeResponse


@pytest.mark.asyncio
async def test_begin_turn_reuses_same_session_instance(fake_client_factory):
    factory, _ = fake_client_factory
    session = factory()

    g = gemini_live.GeminiLive(on_transcript=lambda t, f: None)
    await g.start()

    snapshot_session = g._session
    snapshot_send_task = g._send_task
    snapshot_recv_task = g._recv_task
    snapshot_flush_task = g._flush_task

    for _ in range(3):
        await g.begin_turn()

    # Same underlying session + same background tasks across 3 turns.
    assert g._session is snapshot_session
    assert g._send_task is snapshot_send_task
    assert g._recv_task is snapshot_recv_task
    assert g._flush_task is snapshot_flush_task
    assert not snapshot_send_task.done()
    assert not snapshot_recv_task.done()
    assert not snapshot_flush_task.done()

    await g.stop()


@pytest.mark.asyncio
async def test_begin_turn_resets_per_turn_state_but_preserves_totals(
    fake_client_factory,
):
    factory, _ = fake_client_factory
    session = factory()

    g = gemini_live.GeminiLive(on_transcript=lambda t, f: None)
    await g.start()
    await g.begin_turn()

    # Simulate a transcript in turn #1
    g.interim_buffer = "hello world"
    g._first_transcription_ts = 123.456
    g._transcriptions_total = 3

    await g.begin_turn()

    assert g.interim_buffer == ""
    assert g._first_transcription_ts is None
    assert g._first_audio_ts is None
    # Session-lifetime counter accumulates across turns.
    assert g._transcriptions_total == 3

    await g.stop()


@pytest.mark.asyncio
async def test_begin_turn_on_dead_session_raises(fake_client_factory):
    factory, _ = fake_client_factory
    _ = factory()

    g = gemini_live.GeminiLive(on_transcript=lambda t, f: None)
    await g.start()

    # Simulate the session dying without going through stop()
    g._active = False

    with pytest.raises(RuntimeError, match="begin_turn on dead session"):
        await g.begin_turn()

    await g.stop()


@pytest.mark.asyncio
async def test_flush_final_does_not_kill_background_tasks(fake_client_factory):
    factory, _ = fake_client_factory
    session = factory()

    g = gemini_live.GeminiLive(on_transcript=lambda t, f: None)
    await g.start()
    await g.begin_turn()

    # Push a finalizing response so flush_final() has something to signal on
    session.push_response(_FakeResponse(text="hi", turn_complete=True))

    await g.flush_final(timeout=1.0)

    assert g._session is not None
    assert not g._send_task.done()
    assert not g._recv_task.done()
    assert not g._flush_task.done()

    await g.stop()


@pytest.mark.asyncio
async def test_first_turn_skips_redundant_end_start(fake_client_factory):
    """
    turn #1 must not emit activity_end/activity_start — start() already
    sent activity_start during pre-warm, and the window is still open.
    """
    factory, _ = fake_client_factory
    session = factory()

    g = gemini_live.GeminiLive(on_transcript=lambda t, f: None)
    await g.start()

    # Snapshot call-counts after start() but before the first begin_turn.
    start_ends = sum(1 for k, _ in session.calls if k == "activity_end")
    start_starts = sum(1 for k, _ in session.calls if k == "activity_start")

    await g.begin_turn()

    post1_ends = sum(1 for k, _ in session.calls if k == "activity_end")
    post1_starts = sum(1 for k, _ in session.calls if k == "activity_start")

    # No additional end/start emitted on turn #1.
    assert post1_ends == start_ends
    assert post1_starts == start_starts

    # Turn #2 MUST emit the end/start pair.
    await g.begin_turn()
    post2_ends = sum(1 for k, _ in session.calls if k == "activity_end")
    post2_starts = sum(1 for k, _ in session.calls if k == "activity_start")
    assert post2_ends == start_ends + 1
    assert post2_starts == start_starts + 1

    await g.stop()


@pytest.mark.asyncio
async def test_begin_turn_waits_for_in_flight_restart(fake_client_factory):
    """
    A voice-tap arriving during the 29-min token refresh must block on the
    restart instead of racing it and triggering a second redundant restart.
    """
    factory, _ = fake_client_factory
    _ = factory()

    g = gemini_live.GeminiLive(on_transcript=lambda t, f: None)
    await g.start()
    await g.begin_turn()  # bump turn_counter past 0 so precondition holds

    # Simulate a restart in flight.
    g._restarting = True
    g._restart_done_event.clear()

    async def caller():
        await g.begin_turn()
        return True

    task = asyncio.create_task(caller())

    # Should block — restart is "in flight". Give it 150 ms to prove it's
    # not short-circuiting.
    await asyncio.sleep(0.15)
    assert not task.done(), "begin_turn did not wait for restart to complete"

    # Simulate restart completing
    g._restarting = False
    g._restart_done_event.set()

    # begin_turn should now complete within its normal fast-path budget.
    result = await asyncio.wait_for(task, timeout=1.0)
    assert result is True

    await g.stop()
