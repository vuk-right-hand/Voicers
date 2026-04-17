"""
Cause D — _start_voice must translate every failure mode into a structured
voice-status error that reaches the PWA.

Pre-fix: `loop.create_task(self._gemini.start())` in the `voice-start` branch
ate every exception as an unhandled-task log line. PWA had already set
`status=listening` locally and never got a callback, so "today nothing at all"
was completely undiagnosable from the user side.

Fix:
  - `_start_voice` wraps `self._gemini.start()` in try/except
  - `_classify_start_error` maps the exception onto a fixed taxonomy
    ("token" | "model" | "handshake" | "unknown")
  - `_send_status` sends the structured error — with a fallback queue for the
    case where the data channel isn't open yet

This test is PARAMETERIZED across every reason in the taxonomy. If Google
renames an SDK exception class or rephrases a message in a future release,
the relevant sub-case fails loudly — that's exactly the signal we want,
rather than silently collapsing to "unknown".

The +1 non-parameterized case at the end covers the closed-channel race: an
error that fires while the data channel is still opening must be stashed in
_pending_status_flushes and then drained by on_open.

Run: cd host && venv/Scripts/python.exe -m pytest tests/test_start_voice_error_surfaces.py -v
"""
from __future__ import annotations

import json

import pytest

import gemini_live
import webrtc_host


class FakeChannel:
    """Minimal aiortc DataChannel stand-in for capturing .send() payloads."""

    def __init__(self, readyState: str = "open"):
        self.readyState = readyState
        self.sends: list[str] = []

    def send(self, payload: str) -> None:
        self.sends.append(payload)


def _make_host() -> webrtc_host.WebRTCHost:
    """Bare WebRTCHost, bypassing __init__ so we don't spin a ClipboardWatcher.

    Mirrors the pattern from test_connection_state.py. Sets the exact subset
    of attributes _start_voice reads.
    """
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
    return host


@pytest.mark.parametrize(
    "reason,exc_factory",
    [
        (
            "token",
            # _fetch_hosted_gemini_token converts all errors to RuntimeError
            lambda: RuntimeError("Failed to fetch Pro token: 401 - Unauthorized"),
        ),
        (
            "model",
            lambda: RuntimeError("model not found: gemini-bogus"),
        ),
        (
            "handshake",
            lambda: ConnectionError("websocket handshake failed"),
        ),
        (
            "unknown",
            lambda: ValueError("something unexpected happened"),
        ),
    ],
)
@pytest.mark.asyncio
async def test_start_voice_surfaces_each_error_reason(
    fake_client_factory, monkeypatch, reason, exc_factory
):
    factory, _ = fake_client_factory

    host = _make_host()
    channel = FakeChannel(readyState="open")
    # Session-lifecycle promotion (2026-04-17): _prewarm_gemini's callbacks
    # bind against self.data_channel (the instance attribute), not the
    # parameter passed to _start_voice — the channel doesn't exist yet at
    # offer-time. Production always has data_channel set by the time
    # _start_voice runs, so mirror that here.
    host.data_channel = channel

    # Install a GeminiLive.start that raises the parameterized exception.
    async def raising_start(self, _preserve_buffer: bool = False):
        raise exc_factory()

    monkeypatch.setattr(gemini_live.GeminiLive, "start", raising_start)

    await host._start_voice(channel)

    # Exactly one voice-status error payload should have been sent.
    statuses = [json.loads(s) for s in channel.sends]
    errors = [s for s in statuses if s.get("status") == "error"]
    assert len(errors) == 1, (
        f"Expected exactly 1 voice-status: error send, got {len(errors)} — "
        f"all sends: {statuses}"
    )
    assert errors[0]["reason"] == reason, (
        f"Classifier collapsed {exc_factory().__class__.__name__} onto "
        f"'{errors[0]['reason']}' — expected '{reason}'. If Google changed the "
        "SDK exception shape, update _classify_start_error AND this parametrize."
    )

    # Cleanup invariants.
    assert host._voice_active is False, "_voice_active must be False after error"
    assert host._voice_mode is None
    assert host._gemini is None


@pytest.mark.asyncio
async def test_start_voice_error_queues_when_channel_not_open(monkeypatch):
    """Audit catch — the closed-channel race.

    If the data channel is still in 'connecting' state when _start_voice
    fails, `channel.send()` would no-op or throw on aiortc, and the error
    would never reach the PWA. _send_status must stash it in
    _pending_status_flushes so `on_open` can drain it as soon as the channel
    is ready.
    """
    host = _make_host()
    channel = FakeChannel(readyState="connecting")

    async def raising_start(self, _preserve_buffer: bool = False):
        raise RuntimeError("Failed to fetch Pro token: 401")

    monkeypatch.setattr(gemini_live.GeminiLive, "start", raising_start)

    await host._start_voice(channel)

    # Nothing was sent directly.
    assert channel.sends == [], "send() called while channel was 'connecting'"

    # But the error was queued.
    assert len(host._pending_status_flushes) == 1, (
        f"Error not queued — PWA would never see it. "
        f"_pending_status_flushes={host._pending_status_flushes}"
    )
    payload = host._pending_status_flushes[0]
    assert payload["type"] == "voice-status"
    assert payload["status"] == "error"
    assert payload["reason"] == "token"

    # Simulate on_open draining — exactly what webrtc_host.on_open does.
    channel.readyState = "open"
    pending = host._pending_status_flushes
    host._pending_status_flushes = []
    for item in pending:
        channel.send(json.dumps(item))

    drained = [json.loads(s) for s in channel.sends]
    assert len(drained) == 1
    assert drained[0]["status"] == "error"
    assert drained[0]["reason"] == "token"


@pytest.mark.asyncio
async def test_send_status_with_none_channel_queues():
    """Session-lifecycle promotion (2026-04-17): pre-warm runs at offer-time,
    BEFORE the data channel exists. _send_status must queue on channel=None so
    pre-warm errors (reason="model"/"token") reach the PWA when on_open drains.

    Must NOT crash on None.readyState — the original invariant still holds.
    """
    host = _make_host()
    # Must not raise.
    host._send_status(None, {"type": "voice-status", "status": "error", "reason": "model"})
    # Must queue — not silently dropped.
    assert len(host._pending_status_flushes) == 1
    assert host._pending_status_flushes[0]["reason"] == "model"


@pytest.mark.asyncio
async def test_classify_start_error_taxonomy():
    """Direct unit test of the classifier so a future refactor doesn't
    silently collapse cases. Mirrors the docstring table in webrtc_host.py."""
    cls = webrtc_host.WebRTCHost._classify_start_error

    # token
    assert cls(RuntimeError("Pro token fetch failed")) == "token"
    assert cls(RuntimeError("401 Unauthorized")) == "token"
    assert cls(RuntimeError("Network error reaching Vercel API")) == "token"
    assert cls(RuntimeError("USER_ID not set in environment")) == "token"
    assert cls(RuntimeError("GEMINI_API_KEY not set")) == "token"

    # model
    assert cls(RuntimeError("model not found: gemini-bogus")) == "model"
    assert cls(Exception("404 Model deprecated")) == "model"

    # handshake
    assert cls(ConnectionError("websocket handshake failed")) == "handshake"

    # unknown
    assert cls(ValueError("unexpected")) == "unknown"
