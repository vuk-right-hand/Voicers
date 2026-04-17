"""
Cause A — boot-race regression test.

Pre-fix: `self._active = True` was set AFTER `_fetch_hosted_gemini_token`
(~1 s) and after `client.aio.live.connect().__aenter__()` (~0.5 s). Incoming
PCM from the phone hit `send_audio()`, saw `_active == False`, and was
silently dropped. The user lost the first ~3-5 s of every dictation.

Fix: `_active = True` is the first line of `start()` before any `await`. The
200-slot / 20 s queue absorbs audio while the token fetch + handshake run.
When `_session` is finally non-None, `_send_loop` drains the queue and those
chunks reach Gemini unharmed.

This test stalls `_fetch_hosted_gemini_token` for 1 s and
`live.connect().__aenter__()` for 1.5 s, then pumps 25 PCM chunks through
`send_audio()` during the boot window. It asserts:
  1. All 25 chunks are delivered to the fake session (none dropped).
  2. The audio queue never approaches maxsize=200 (proves we have headroom
     and aren't silently dropping via QueueFull — audit catch).

Run: cd host && venv/Scripts/python.exe -m pytest tests/test_gemini_boot_no_drop.py -v
"""
from __future__ import annotations

import asyncio

import pytest

import gemini_live


@pytest.mark.asyncio
async def test_boot_does_not_drop_audio_before_session_ready(
    fake_client_factory, monkeypatch
):
    factory, holder = fake_client_factory

    # Hosted mode so the token fetch path is exercised too.
    monkeypatch.setenv("USE_HOSTED_API", "true")
    monkeypatch.setenv("USER_ID", "test-user")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "test-key")

    # Token fetch takes 1 s — during this window _active MUST already be True.
    def slow_fetch():
        import time as _t
        _t.sleep(1.0)
        return "fake-token", _t.monotonic() + 1800

    monkeypatch.setattr(gemini_live, "_fetch_hosted_gemini_token", slow_fetch)

    session = factory(enter_delay=1.5)

    transcripts: list[tuple[str, bool]] = []
    g = gemini_live.GeminiLive(on_transcript=lambda t, f: transcripts.append((t, f)))

    async def pump_chunks():
        # Wait until start() has flipped _active (first line, pre-await).
        # Poll every 10 ms up to 100 ms.
        for _ in range(10):
            if g._active:
                break
            await asyncio.sleep(0.01)
        assert g._active, "Regression: _active not flipped before first await"

        peak_qsize = 0
        for i in range(25):
            await g.send_audio(bytes([i & 0xFF]) * 100)
            peak_qsize = max(peak_qsize, g._audio_queue.qsize())
            await asyncio.sleep(0.02)  # 25 chunks over ~0.5 s
        return peak_qsize

    # Run start() and the chunk pump concurrently.
    start_task = asyncio.create_task(g.start())
    pump_task = asyncio.create_task(pump_chunks())

    await start_task
    peak = await pump_task

    # Let _send_loop drain anything still queued.
    for _ in range(50):
        if g._audio_queue.qsize() == 0 and len(session.audio_calls()) >= 25:
            break
        await asyncio.sleep(0.02)

    # Assertion 1: every chunk made it.
    assert len(session.audio_calls()) == 25, (
        f"Expected 25 audio chunks delivered, got {len(session.audio_calls())} — "
        "boot-race regression"
    )

    # Assertion 2: queue never approached maxsize=200 (audit catch).
    # 25 chunks should never push past, say, 30 — 200 would mean silent QueueFull.
    assert peak < 50, f"Queue peaked at {peak} — too close to maxsize"
    assert peak <= g._audio_queue.maxsize, "Queue overflowed"

    await g.stop()


@pytest.mark.asyncio
async def test_boot_active_flipped_before_any_await(fake_client_factory, monkeypatch):
    """Directly assert the invariant: first line of start() flips _active.

    Complements the timing-based test above with a deterministic check that
    doesn't depend on sleep ordering — if someone moves `_active = True` below
    an await in a future refactor, this flips before that test even finishes.
    """
    factory, _ = fake_client_factory

    # Use a session that blocks forever on __aenter__; we'll cancel start().
    blocker = asyncio.Event()

    async def block_forever():
        await blocker.wait()

    session = factory()

    # Monkey-patch the session's __aenter__ to block forever.
    original_aenter = session.__aenter__

    async def blocking_aenter():
        await block_forever()
        return await original_aenter()

    session.__aenter__ = blocking_aenter  # type: ignore

    g = gemini_live.GeminiLive(on_transcript=lambda t, f: None)
    start_task = asyncio.create_task(g.start())

    # Give start() a moment to reach the block point.
    await asyncio.sleep(0.05)

    # If boot-race fix is in place, _active is True even though __aenter__
    # hasn't returned yet.
    assert g._active, "Regression: _active should be True before session is ready"

    # Clean shutdown.
    blocker.set()
    start_task.cancel()
    try:
        await start_task
    except (asyncio.CancelledError, Exception):
        pass
