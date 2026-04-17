"""
Cause I — _flush_loop must survive a transient send failure.

Pre-fix: `_flush_loop` did `break` on any exception. One WebSocket blip (a
momentary congestion, a retry-safe timeout) and flushing was off FOREVER.
Transcription degraded 20-40 s later with zero recovery and no log signal
loud enough to explain why.

Fix: changed `break` to `continue` with a warning log. A transient error
gets one ugly log line and the next cycle retries cleanly.

This test installs a session where `send_realtime_input(activity_end=...)`
raises on the FIRST call, then succeeds. We drive two flush cycles and
verify the second one completed — proving the loop stayed alive.

Run: cd host && venv/Scripts/python.exe -m pytest tests/test_gemini_flush_resilient.py -v
"""
from __future__ import annotations

import asyncio

import pytest

import gemini_live


@pytest.mark.asyncio
async def test_flush_loop_continues_after_transient_failure(
    fake_client_factory, monkeypatch
):
    factory, _ = fake_client_factory

    # Build a raise-once predicate for the fake session.
    raised_once = {"done": False}

    def raise_on_first_activity_end(kind, payload):
        if kind == "activity_end" and not raised_once["done"]:
            raised_once["done"] = True
            return True
        return False

    session = factory(send_raises_on=raise_on_first_activity_end)

    # Speed up the flush cadence so we don't wait 30 s for 2 cycles.
    monkeypatch.setattr(gemini_live, "_FLUSH_INTERVAL_S", 0.1)

    g = gemini_live.GeminiLive(on_transcript=lambda t, f: None)
    await g.start()

    # Let two cycles run: first raises, second succeeds.
    # 0.1 s × 2 + tolerance = 0.35 s.
    await asyncio.sleep(0.5)

    await g.stop()

    # Verify:
    #  - We DID raise once (proves the test actually exercised the failure).
    #  - _flushes_total advanced past 0 (proves the loop recovered).
    assert raised_once["done"], (
        "Test setup failed: activity_end was never called"
    )
    assert g._flushes_total >= 1, (
        f"_flush_loop died after first transient error — Cause I regression. "
        f"_flushes_total={g._flushes_total}"
    )
