"""
Cause C — flush_final() must wait for trailing transcription without deadlock.

Pre-fix: `_stop_voice` read `interim_buffer` and immediately called `stop()`.
The last 200-500 ms of audio was still in flight; its transcription arrived
after the session had been torn down. Final words were dropped on the floor.

Fix: GeminiLive.flush_final() drains the queue, sends activity_end, and
awaits an asyncio.Event signaled by _recv_loop on either:
  - the next input_transcription update (trailing text arrives), or
  - turn_complete (server confirms end-of-turn).

Three cases covered:

1. `test_flush_final_captures_late_transcription`
   Mock session emits input_transcription 400 ms AFTER activity_end.
   Expect: flush_final returns with that transcription in the buffer.

2. `test_flush_final_early_exits_on_turn_complete`
   Mock session emits turn_complete 100 ms after activity_end. Expect:
   flush_final returns within ~250 ms (NOT the 1.5 s timeout).

3. `test_flush_final_no_deadlock_when_turn_already_closed` (audit catch)
   Turn already closed (e.g. prior flush cycle ran turn_complete). Expect:
   flush_final returns in <10 ms — no 1.5 s penalty on every Stop tap.

Run: cd host && venv/Scripts/python.exe -m pytest tests/test_gemini_flush_final.py -v
"""
from __future__ import annotations

import asyncio
import time

import pytest

import gemini_live


@pytest.mark.asyncio
async def test_flush_final_captures_late_transcription(fake_client_factory):
    factory, _ = fake_client_factory
    session = factory()

    g = gemini_live.GeminiLive(on_transcript=lambda t, f: None)
    await g.start()

    # Arrange: after activity_end is sent, simulate the 400 ms ASR delay by
    # pushing a late transcription response onto the session.
    from tests.conftest import _FakeResponse  # noqa: E402

    async def late_transcription():
        # Wait for flush_final to send activity_end.
        for _ in range(100):
            if any(kind == "activity_end" for kind, _ in session.calls):
                break
            await asyncio.sleep(0.01)
        await asyncio.sleep(0.4)  # simulate 400 ms ASR tail
        session.push_response(_FakeResponse(text="five"))

    tail_task = asyncio.create_task(late_transcription())

    final = await g.flush_final(timeout=1.5)

    await tail_task
    await g.stop()

    assert "five" in final, (
        f"flush_final dropped trailing transcription — got {final!r}"
    )


@pytest.mark.asyncio
async def test_flush_final_early_exits_on_turn_complete(fake_client_factory):
    factory, _ = fake_client_factory
    session = factory()

    g = gemini_live.GeminiLive(on_transcript=lambda t, f: None)
    await g.start()

    from tests.conftest import _FakeResponse  # noqa: E402

    async def emit_turn_complete():
        for _ in range(100):
            if any(kind == "activity_end" for kind, _ in session.calls):
                break
            await asyncio.sleep(0.01)
        await asyncio.sleep(0.1)  # 100 ms
        session.push_response(_FakeResponse(turn_complete=True))

    emit_task = asyncio.create_task(emit_turn_complete())

    t0 = time.monotonic()
    await g.flush_final(timeout=1.5)
    elapsed = time.monotonic() - t0

    await emit_task
    await g.stop()

    # Tolerant upper bound: 600 ms. Turn-complete emit runs at ~100 ms plus
    # a scheduler blip; the critical point is we do NOT hit the 1.5 s timeout.
    assert elapsed < 0.6, (
        f"flush_final took {elapsed:.3f}s — did not early-exit on turn_complete"
    )


@pytest.mark.asyncio
async def test_flush_final_no_deadlock_when_turn_already_closed(fake_client_factory):
    """Audit catch — the deadlock guard.

    If `turn_complete` was already observed BEFORE flush_final is called
    (common when the user naturally paused between phrases and the prior
    flush cycle closed the turn), flush_final must return immediately.
    Otherwise every Stop tap pays a 1.5 s penalty.
    """
    factory, _ = fake_client_factory
    session = factory()

    g = gemini_live.GeminiLive(on_transcript=lambda t, f: None)
    await g.start()

    # Force turn already closed.
    from tests.conftest import _FakeResponse  # noqa: E402

    session.push_response(_FakeResponse(turn_complete=True))

    # Give _recv_loop a moment to process the turn_complete and flip _turn_active.
    for _ in range(50):
        if not g._turn_active:
            break
        await asyncio.sleep(0.01)

    assert not g._turn_active, "Test setup failed: _turn_active still True"

    t0 = time.monotonic()
    await g.flush_final(timeout=1.5)
    elapsed = time.monotonic() - t0

    await g.stop()

    # <10 ms is the audit-specified bound; allow 50 ms for scheduler jitter.
    assert elapsed < 0.05, (
        f"flush_final took {elapsed:.3f}s with turn already closed — "
        "deadlock guard regression, users will pay 1.5s on every Stop tap"
    )
