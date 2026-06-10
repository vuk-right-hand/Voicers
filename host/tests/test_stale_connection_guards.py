"""
Stale-connection guards (2026-06-10 pm).

With PWA auto-reconnect, the phone re-offers while the previous connection is
still dying. The old connection's death events then land AFTER the new
connection is set up, and used to destroy it:

  - old data channel's `close` → tore down the NEW Gemini session (and
    stopped the clipboard watcher) right as the user connected
  - zombie pc's consent-expiry `failed`/`closed` (fires ~30 s later) → same
    teardown + republished host-ready/pc_status=waiting mid-session
  - `_prewarm_gemini` on a re-offer captured its ready-event AFTER teardown
    nulled it → orphaned waiter → guaranteed 8 s timeout → "Voice server
    unreachable" on the first tap of every reconnect

Run: cd host && venv/Scripts/python.exe -m pytest tests/test_stale_connection_guards.py -v
"""
from __future__ import annotations

import asyncio

import pytest

import webrtc_host


class StubWatcher:
    def __init__(self):
        self.stops = 0

    def start(self):
        pass

    def stop(self):
        self.stops += 1


class StubGemini:
    def __init__(self):
        self.stopped = 0
        self.interim_buffer = ""

    async def stop(self):
        self.stopped += 1


class FakeDC:
    """Minimal pyee-style emitter matching the slice _setup_data_channel uses."""

    def __init__(self, ready: str = "connecting"):
        self.readyState = ready
        self.sends: list[str] = []
        self._handlers: dict[str, list] = {}

    def on(self, event, f=None):
        def register(fn):
            self._handlers.setdefault(event, []).append(fn)
            return fn

        if f is not None:
            return register(f)
        return register

    def emit(self, event):
        for fn in list(self._handlers.get(event, [])):
            fn()

    def send(self, payload):
        self.sends.append(payload)


def _make_host() -> webrtc_host.WebRTCHost:
    host = webrtc_host.WebRTCHost.__new__(webrtc_host.WebRTCHost)
    host.session_id = "test-session"
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
    host._clipboard_watcher = StubWatcher()
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


# ── stale pc events ──────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_stale_pc_failed_event_is_ignored(recorders):
    """A zombie pc's consent-expiry 'failed' must not touch the live session."""
    pc_status_calls, signaling_writes = recorders
    host = _make_host()
    current_pc = object()
    zombie_pc = object()
    host.pc = current_pc
    host._gemini = StubGemini()

    await host._on_connection_state("failed", pc=zombie_pc)

    assert host._gemini.stopped == 0, "stale event must not tear down Gemini"
    assert pc_status_calls == []
    assert signaling_writes == [], "stale event must not republish host-ready"


@pytest.mark.asyncio
async def test_current_pc_failed_event_still_processed(recorders):
    pc_status_calls, signaling_writes = recorders
    host = _make_host()
    current_pc = object()
    host.pc = current_pc
    gemini = StubGemini()
    host._gemini = gemini

    await host._on_connection_state("failed", pc=current_pc)

    assert gemini.stopped == 1
    assert ("test-session", "waiting") in pc_status_calls
    assert any(w[1]["type"] == "host-ready" for w in signaling_writes)


@pytest.mark.asyncio
async def test_pc_none_treated_as_current(recorders):
    """Direct calls (tests, legacy paths) without a pc still process."""
    pc_status_calls, _ = recorders
    host = _make_host()

    await host._on_connection_state("failed")

    assert ("test-session", "waiting") in pc_status_calls


# ── stale data-channel close ─────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_stale_channel_close_does_not_teardown_new_session():
    host = _make_host()
    gemini = StubGemini()
    host._gemini = gemini

    old_channel = FakeDC(ready="connecting")
    host.data_channel = old_channel
    host._setup_data_channel(old_channel)

    # New offer arrived: a fresh channel is now current.
    new_channel = FakeDC(ready="connecting")
    host.data_channel = new_channel

    old_channel.emit("close")
    await asyncio.sleep(0.02)  # let any (wrongly) spawned teardown task run

    assert gemini.stopped == 0, "old channel close must not kill the new session"
    assert host._clipboard_watcher.stops == 0


@pytest.mark.asyncio
async def test_current_channel_close_still_tears_down():
    host = _make_host()
    gemini = StubGemini()
    host._gemini = gemini

    channel = FakeDC(ready="connecting")
    host.data_channel = channel
    host._setup_data_channel(channel)

    channel.emit("close")
    await asyncio.sleep(0.02)

    assert gemini.stopped == 1
    assert host._clipboard_watcher.stops == 1


# ── pre-warm ready-event survives re-offer teardown ──────────────────────────


@pytest.mark.asyncio
async def test_prewarm_on_reoffer_signals_the_new_waiter(fake_client_factory):
    """Re-offer while a live Gemini exists: _prewarm_gemini's internal
    teardown nulls self._gemini_ready — the freshly allocated event must be
    captured first and restored, or _start_voice waits 8 s for a signal that
    never comes ("Voice server unreachable" on every reconnect's first tap)."""
    factory, _ = fake_client_factory
    factory(enter_delay=0.0)

    host = _make_host()
    host._gemini = StubGemini()  # live session from the previous connection

    # Mirror of _handle_offer's re-offer block:
    host._gemini_ready = asyncio.Event()
    new_event = host._gemini_ready

    await host._prewarm_gemini()

    assert new_event.is_set(), "pre-warm completed but never signalled the waiter"
    assert host._gemini_ready is new_event, "_gemini_ready must be the live event"
    assert host._gemini is not None and not isinstance(host._gemini, StubGemini)

    await host._teardown_gemini()
