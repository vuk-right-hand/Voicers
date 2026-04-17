"""
Cause B — activity_end/activity_start window must bracket audio atomically.

Per Gemini Live docs (VAD-disabled mode): any audio sent OUTSIDE the window
[activity_start, activity_end) is discarded server-side. The old flush loop
did `activity_end` → sleep(0.05) → `activity_start`, and during that 50 ms
gap `_send_loop` could concurrently push audio through — those chunks were
thrown away by the server.

Fix: both `_send_loop` and `_flush_loop` acquire `self._activity_lock` around
the ONLY write site. This test verifies that no audio call is recorded
between a logged activity_end and the next activity_start.

Run: cd host && venv/Scripts/python.exe -m pytest tests/test_gemini_activity_lock.py -v
"""
from __future__ import annotations

import asyncio

import pytest

import gemini_live


@pytest.mark.asyncio
async def test_no_audio_between_activity_end_and_activity_start(
    fake_client_factory, monkeypatch
):
    factory, _ = fake_client_factory
    session = factory()

    g = gemini_live.GeminiLive(on_transcript=lambda t, f: None)
    await g.start()

    # Drive heavy concurrent send pressure: pump chunks continuously, then
    # force flush_loop to fire by reducing the interval to ~0 and nudging it.
    async def pump_audio():
        for i in range(500):
            await g.send_audio(b"\x00\x10" * 800)  # 1.6 KB per chunk
            await asyncio.sleep(0)  # yield

    pump_task = asyncio.create_task(pump_audio())

    # Wait until at least a few audio calls have happened, then manually
    # perform the activity_end/activity_start cycle exactly the way the
    # production _flush_loop does, using the same lock.
    await asyncio.sleep(0.01)
    while len(session.audio_calls()) < 10:
        await asyncio.sleep(0.005)

    # Perform 3 flush cycles under the lock, interleaved with continued
    # audio pressure from the pump task.
    from google.genai import types

    for _ in range(3):
        async with g._activity_lock:
            await session.send_realtime_input(activity_end=types.ActivityEnd())
            await session.send_realtime_input(activity_start=types.ActivityStart())
        await asyncio.sleep(0.005)

    pump_task.cancel()
    try:
        await pump_task
    except (asyncio.CancelledError, Exception):
        pass

    await g.stop()

    # Walk the recorded call order and verify no audio call ever appears
    # between an activity_end and the next activity_start.
    in_gap = False
    for kind, _ in session.calls:
        if kind == "activity_end":
            in_gap = True
        elif kind == "activity_start":
            in_gap = False
        elif kind == "audio" and in_gap:
            pytest.fail(
                "Audio call recorded inside [activity_end, activity_start) gap — "
                "Cause B regression: flush cycle is leaking audio to /dev/null"
            )

    # Sanity: we actually ran some cycles.
    assert sum(1 for k, _ in session.calls if k == "activity_end") >= 3, (
        "Test did not exercise 3 flush cycles"
    )
    assert sum(1 for k, _ in session.calls if k == "audio") >= 10, (
        "Test did not push any audio through the lock"
    )
