"""
Self-healing Gemini session (2026-06-10).

Root cause of "voice dies after a few minutes": the Live API closes every
WebSocket after ~10 min (GoAway → 1011). The old code only restarted when a
voice turn was ACTIVE, so idle deaths (the common case — GoAway lands between
dictations) were never healed, and the next voice-tap blew up with an uncaught
websockets.ConnectionClosedError, leaving voice dead until full reconnect.

Covers:
  - _restart_gemini runs for IDLE sessions (the regression that broke voice)
  - idle restart failure stays quiet; active restart failure surfaces an error
  - begin_turn raising a non-RuntimeError routes to restart + retry, and the
    tap SURVIVES when the retry succeeds
  - GoAway proactively fires on_session_dead (no waiting for the 1011 close)
  - restart() retries and clears a stale resumption handle between attempts

Run: cd host && venv/Scripts/python.exe -m pytest tests/test_session_self_heal.py -v
"""
from __future__ import annotations

import asyncio
import json

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
    host.pc = None
    return host


class StubGemini:
    """Minimal stand-in for GeminiLive used by _restart_gemini tests."""

    def __init__(self, restart_raises: Exception | None = None):
        self.restart_calls = 0
        self._restart_raises = restart_raises
        self.interim_buffer = ""

    async def restart(self):
        self.restart_calls += 1
        if self._restart_raises:
            raise self._restart_raises


# ── _restart_gemini must run when idle ───────────────────────────────────────


@pytest.mark.asyncio
async def test_restart_gemini_runs_when_idle():
    """THE regression: a GoAway between voice turns must still restart.

    The old guard `if not self._voice_active ... return` skipped idle
    restarts entirely — the session stayed dead until the phone reconnected.
    """
    host = _make_host()
    host._voice_active = False  # idle — no dictation in flight
    stub = StubGemini()
    host._gemini = stub

    await host._restart_gemini(channel=None)

    assert stub.restart_calls == 1, "idle session death must trigger restart"
    assert host._gemini_restarting is False


@pytest.mark.asyncio
async def test_restart_gemini_idle_failure_stays_quiet():
    """Idle restart failure must not spam the PWA — next tap retries."""
    host = _make_host()
    host._voice_active = False
    host._gemini = StubGemini(restart_raises=RuntimeError("still down"))
    channel = FakeChannel()
    host.data_channel = channel

    await host._restart_gemini(channel)

    assert channel.sends == [], "idle failure must not surface a user-facing error"
    assert host._pending_status_flushes == []
    assert host._gemini_restarting is False


@pytest.mark.asyncio
async def test_restart_gemini_active_failure_surfaces_error():
    """Mid-dictation restart failure must reset the turn and notify the PWA."""
    host = _make_host()
    host._voice_active = True
    host._voice_mode = "dictation"
    host._gemini = StubGemini(restart_raises=RuntimeError("still down"))
    channel = FakeChannel()

    await host._restart_gemini(channel)

    assert host._voice_active is False
    errors = [json.loads(s) for s in channel.sends]
    assert any(
        e.get("status") == "error" and e.get("reason") == "handshake" for e in errors
    ), f"expected handshake error, got {channel.sends}"


@pytest.mark.asyncio
async def test_restart_gemini_noops_without_session_or_when_already_restarting():
    host = _make_host()

    # No session at all (connection torn down) — nothing to do.
    host._gemini = None
    await host._restart_gemini(None)

    # Already restarting — second call must not double-restart.
    stub = StubGemini()
    host._gemini = stub
    host._gemini_restarting = True
    await host._restart_gemini(None)
    assert stub.restart_calls == 0


# ── begin_turn failure routes to restart + retry; the tap survives ───────────


@pytest.mark.asyncio
async def test_begin_turn_transport_error_restarts_and_tap_survives(monkeypatch):
    """A dead-WS exception (NOT RuntimeError) from begin_turn must:
    1) be caught (it used to escape as 'Task exception was never retrieved'),
    2) trigger _restart_gemini,
    3) retry begin_turn so the user's tap still lands.
    """
    host = _make_host()
    channel = FakeChannel()
    host.data_channel = channel
    host._gemini_ready = asyncio.Event()
    host._gemini_ready.set()

    class FlakyGemini:
        def __init__(self):
            self.begin_calls = 0
            self.interim_buffer = ""

        async def begin_turn(self):
            self.begin_calls += 1
            if self.begin_calls == 1:
                # websockets.ConnectionClosedError is not importable in a
                # minimal harness — any non-RuntimeError exercises the same
                # (previously fatal) path.
                raise OSError("received 1011 (internal error)")

    flaky = FlakyGemini()
    host._gemini = flaky

    restart_calls: list[bool] = []

    async def fake_restart(ch):
        restart_calls.append(True)  # "fixes" the session — next begin_turn succeeds

    monkeypatch.setattr(host, "_restart_gemini", fake_restart)

    await host._start_voice(channel)

    assert restart_calls == [True]
    assert flaky.begin_calls == 2, "begin_turn must be retried after restart"
    assert host._voice_active is True, "the tap must survive a healed session"
    statuses = [json.loads(s) for s in channel.sends]
    assert any(s.get("status") == "listening" for s in statuses)

    # Cleanup: cancel watchdogs spawned by the successful start.
    await host._stop_voice(channel)


@pytest.mark.asyncio
async def test_begin_turn_failure_after_restart_surfaces_error(monkeypatch):
    """If the retry ALSO fails, surface the handshake error and reset state
    instead of leaving _voice_active stuck True."""
    host = _make_host()
    channel = FakeChannel()
    host.data_channel = channel
    host._gemini_ready = asyncio.Event()
    host._gemini_ready.set()

    class DeadGemini:
        interim_buffer = ""

        async def begin_turn(self):
            raise OSError("ws is gone")

    host._gemini = DeadGemini()

    async def fake_restart(ch):
        pass  # restart "succeeds" but session is still dead

    monkeypatch.setattr(host, "_restart_gemini", fake_restart)

    await host._start_voice(channel)

    assert host._voice_active is False
    errors = [json.loads(s) for s in channel.sends]
    assert any(
        e.get("status") == "error" and e.get("reason") == "handshake" for e in errors
    )


# ── GoAway fires on_session_dead proactively ─────────────────────────────────


@pytest.mark.asyncio
async def test_goaway_triggers_session_dead_callback(fake_client_factory):
    """GoAway must trigger the restart callback IMMEDIATELY — the old code
    just logged 'will restart' and waited for the 1011 close, which only
    healed if a voice turn happened to be active."""
    factory, _ = fake_client_factory
    fake = factory(enter_delay=0.0)

    dead_calls: list[bool] = []
    g = gemini_live.GeminiLive(
        on_transcript=lambda *a: None,
        on_session_dead=lambda: dead_calls.append(True),
    )
    await g.start()

    go_away = type("GoAway", (), {"time_left": "50s"})()
    fake.push_response(_FakeResponse(go_away=go_away))

    # Give the recv loop a few scheduler turns to process the GoAway.
    for _ in range(20):
        if dead_calls:
            break
        await asyncio.sleep(0.01)

    assert dead_calls, "GoAway did not fire on_session_dead proactively"

    await g.stop()


# ── restart() retries and clears stale resumption handles ────────────────────


@pytest.mark.asyncio
async def test_restart_retries_and_clears_stale_resumption_handle(monkeypatch):
    """First reconnect attempt with a stale handle fails (the 1011 'service
    unavailable' seen in production logs). restart() must clear the handle
    and retry fresh instead of giving up."""
    g = gemini_live.GeminiLive(on_transcript=lambda *a: None)
    g._resumption_handle = "stale-handle-from-dead-session"

    start_calls: list[str | None] = []

    async def fake_start(_preserve_buffer=False):
        start_calls.append(g._resumption_handle)
        if len(start_calls) == 1:
            raise RuntimeError("1011 service unavailable")

    monkeypatch.setattr(g, "start", fake_start)
    # Shrink the between-attempt backoff so the test is fast.
    real_sleep = asyncio.sleep
    monkeypatch.setattr(
        gemini_live.asyncio, "sleep", lambda s: real_sleep(min(s, 0.01))
    )

    await g.restart()

    assert len(start_calls) == 2, "restart must retry after a failed attempt"
    assert start_calls[0] == "stale-handle-from-dead-session"
    assert start_calls[1] is None, "stale handle must be cleared before the retry"
    assert g._restart_done_event.is_set()
    assert g._restarting is False


@pytest.mark.asyncio
async def test_restart_raises_after_all_attempts_fail(monkeypatch):
    g = gemini_live.GeminiLive(on_transcript=lambda *a: None)

    async def always_fail(_preserve_buffer=False):
        raise RuntimeError("hard down")

    monkeypatch.setattr(g, "start", always_fail)
    real_sleep = asyncio.sleep
    monkeypatch.setattr(
        gemini_live.asyncio, "sleep", lambda s: real_sleep(min(s, 0.01))
    )

    with pytest.raises(RuntimeError, match="hard down"):
        await g.restart()

    # Even on total failure the done-event must release begin_turn waiters.
    assert g._restart_done_event.is_set()
    assert g._restarting is False
