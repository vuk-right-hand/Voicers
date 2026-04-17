"""
Cause G — double-tap during Gemini connect must not leave a zombie session.

Scenario: user taps the comms button, Gemini begins its ~500 ms connect,
user taps Stop before the session finishes booting.

Pre-fix: `_stop_voice` touched `self._gemini` whose `_session_ctx` was still
mid-`__aenter__`. The partial session leaked, `_voice_active` stayed True
under some interleavings, and the PWA got stuck on "listening".

Fix: `_voice_starting_task` holds the create_task handle for the in-flight
_start_voice. _stop_voice cancels it and awaits it (swallowing CancelledError
and any exception) BEFORE touching `self._gemini`. _start_voice's CancelledError
handler calls `self._gemini.stop()` to drain anything half-built.

Run: cd host && venv/Scripts/python.exe -m pytest tests/test_start_stop_race.py -v
"""
from __future__ import annotations

import asyncio
import json

import pytest

import gemini_live
import webrtc_host


class FakeChannel:
    def __init__(self):
        self.readyState = "open"
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
    return host


@pytest.mark.asyncio
async def test_double_tap_during_connect_leaves_no_zombie(
    fake_client_factory, monkeypatch
):
    factory, _ = fake_client_factory
    # 500 ms enter delay simulates a slow Gemini WebSocket handshake.
    factory(enter_delay=0.5)

    host = _make_host()
    channel = FakeChannel()

    # Track GeminiLive.stop calls so we can verify partial cleanup happened.
    stop_calls: list[bool] = []
    original_stop = gemini_live.GeminiLive.stop

    async def tracked_stop(self):
        stop_calls.append(True)
        await original_stop(self)

    monkeypatch.setattr(gemini_live.GeminiLive, "stop", tracked_stop)

    # Start voice — simulates `voice-start` branch in on_message.
    loop = asyncio.get_running_loop()
    host._voice_starting_task = loop.create_task(host._start_voice(channel))

    # Wait 50 ms, then fire _stop_voice (user double-taps).
    await asyncio.sleep(0.05)
    assert not host._voice_starting_task.done(), (
        "Test setup failed: start completed before double-tap window"
    )

    await host._stop_voice(channel)

    # Give any straggler tasks one more tick.
    await asyncio.sleep(0.05)

    # Post-stop invariants.
    # Session-lifecycle promotion (2026-04-17): _stop_voice no longer tears
    # down _gemini. The session survives until _teardown_gemini fires at DC
    # close / bye / connection-state=failed. The "zombie" this test protects
    # against is voice-active state stuck True, not the Gemini object itself.
    assert host._voice_active is False, "_voice_active left True — zombie session"
    assert host._voice_mode is None
    assert host._voice_starting_task is None, "_voice_starting_task not cleared"
    assert host._no_audio_watchdog is None
    assert host._mid_session_watchdog is None

    # Cleanup: the session created by pre-warm is our responsibility to stop
    # (tests don't run a DC-close lifecycle).
    await host._teardown_gemini()
    assert host._gemini is None, "_teardown_gemini failed to dispose session"

    # PWA got an explicit idle (not left in listening limbo).
    statuses = [json.loads(s) for s in channel.sends]
    idle_statuses = [s for s in statuses if s.get("status") == "idle"]
    assert len(idle_statuses) >= 1, (
        f"PWA never received voice-status: idle after double-tap — "
        f"sends={statuses}"
    )


@pytest.mark.asyncio
async def test_voice_starting_task_cleared_on_normal_completion(
    fake_client_factory, monkeypatch
):
    """Invariant: once _start_voice returns successfully, the task handle
    MUST be nulled — otherwise a subsequent _stop_voice would try to cancel
    an already-completed task (harmless but wrong), AND the second
    voice-start would see a stale task handle."""
    factory, _ = fake_client_factory
    factory(enter_delay=0.0)

    host = _make_host()
    channel = FakeChannel()

    loop = asyncio.get_running_loop()
    host._voice_starting_task = loop.create_task(host._start_voice(channel))
    await host._voice_starting_task

    assert host._voice_starting_task is None, (
        "_voice_starting_task not cleared after successful start — "
        "finally clause regression"
    )
    assert host._voice_active is True

    # Cleanup.
    await host._stop_voice(channel)
