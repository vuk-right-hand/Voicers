"""
Shared pytest fixtures for host tests.

Makes `host/` importable (same bootstrap as test_connection_state.py) and
provides a FakeLiveSession harness so tests can drive GeminiLive without
touching the real Google Gemini Live WebSocket.
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from typing import Any, Callable

import pytest

HOST_DIR = Path(__file__).resolve().parents[1]
if str(HOST_DIR) not in sys.path:
    sys.path.insert(0, str(HOST_DIR))


# ── Fake Gemini Live session ─────────────────────────────────────────────────
#
# Mirrors the tiny slice of the SDK that GeminiLive touches:
#   session.send_realtime_input(activity_start=, activity_end=, audio=)
#   async for response in session.receive():  # yields ServerContent-ish
#
# Each call is recorded on `calls` as a (kind, payload) tuple in the order the
# code-under-test issued them; tests assert on that ordering. `receive()` is
# driven by a programmable queue of Responses that the test pushes via
# `fake.push_response(...)`; pushing `None` closes the iterator, which makes
# GeminiLive re-enter the outer `while self._active` loop.


class _FakeServerContent:
    def __init__(self, text: str | None = None, turn_complete: bool = False):
        self.input_transcription = (
            type("T", (), {"text": text}) if text is not None else None
        )
        self.turn_complete = turn_complete
        self.model_turn = None


class _FakeResponse:
    """Matches the attributes recv_loop reads off each response."""

    def __init__(
        self,
        *,
        text: str | None = None,
        turn_complete: bool = False,
        go_away: Any = None,
        resumption_handle: str | None = None,
    ):
        self.server_content = _FakeServerContent(text=text, turn_complete=turn_complete)
        self.go_away = go_away
        if resumption_handle is not None:
            self.session_resumption_update = type(
                "U", (), {"new_handle": resumption_handle}
            )()
        else:
            self.session_resumption_update = None


class FakeLiveSession:
    """Programmable stand-in for genai.Client.aio.live.connect()'s yielded session."""

    def __init__(
        self,
        *,
        enter_delay: float = 0.0,
        send_raises_on: Callable[[str, dict], bool] | None = None,
    ):
        self._enter_delay = enter_delay
        self._send_raises_on = send_raises_on or (lambda kind, payload: False)
        self.calls: list[tuple[str, Any]] = []
        self._send_lock = asyncio.Lock()  # only to surface interleave ordering faithfully
        self._responses: asyncio.Queue = asyncio.Queue()
        self._closed = False
        self.send_audio_started = asyncio.Event()

    # Context-manager protocol exposed by client.aio.live.connect()
    async def __aenter__(self) -> "FakeLiveSession":
        if self._enter_delay:
            await asyncio.sleep(self._enter_delay)
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        self._closed = True
        await self._responses.put(None)  # unblock any pending receive()

    # SDK surface used by GeminiLive ---------------------------------------
    async def send_realtime_input(self, **kwargs) -> None:
        """Records call order; supports audio=, activity_start=, activity_end=."""
        if "audio" in kwargs:
            kind = "audio"
            payload = {"bytes": len(kwargs["audio"].data)}
        elif "activity_start" in kwargs:
            kind = "activity_start"
            payload = {}
        elif "activity_end" in kwargs:
            kind = "activity_end"
            payload = {}
        else:
            kind = "unknown"
            payload = dict(kwargs)

        if self._send_raises_on(kind, payload):
            raise RuntimeError(f"fake-send failure on {kind}")

        # Record AFTER the possible raise so asserts count only successes
        self.calls.append((kind, payload))
        if kind == "audio":
            self.send_audio_started.set()

    async def receive(self):
        """Async generator yielding queued responses until None sentinel."""
        while True:
            resp = await self._responses.get()
            if resp is None:
                return
            yield resp

    # Test helpers ---------------------------------------------------------
    def push_response(self, resp: _FakeResponse | None) -> None:
        """Queue a response to be yielded by receive(). None closes the iter."""
        self._responses.put_nowait(resp)

    def audio_calls(self) -> list[tuple[str, Any]]:
        return [c for c in self.calls if c[0] == "audio"]


class FakeLiveContextManager:
    """Stand-in for `client.aio.live.connect(model=, config=)`."""

    def __init__(self, session: FakeLiveSession, raise_on_enter: Exception | None = None):
        self._session = session
        self._raise_on_enter = raise_on_enter

    async def __aenter__(self) -> FakeLiveSession:
        if self._raise_on_enter:
            raise self._raise_on_enter
        return await self._session.__aenter__()

    async def __aexit__(self, exc_type, exc, tb):
        return await self._session.__aexit__(exc_type, exc, tb)


class FakeLive:
    """Stand-in for `client.aio.live`."""

    def __init__(self, session: FakeLiveSession, raise_on_enter: Exception | None = None):
        self._session = session
        self._raise_on_enter = raise_on_enter
        self.connect_calls: list[dict] = []

    def connect(self, *, model: str, config: Any) -> FakeLiveContextManager:
        self.connect_calls.append({"model": model, "config": config})
        return FakeLiveContextManager(self._session, raise_on_enter=self._raise_on_enter)


class FakeAio:
    def __init__(self, live: FakeLive):
        self.live = live


class FakeClient:
    """Stand-in for `google.genai.Client(api_key=...)`."""

    def __init__(self, *, session: FakeLiveSession, raise_on_enter: Exception | None = None):
        self.aio = FakeAio(FakeLive(session, raise_on_enter=raise_on_enter))


@pytest.fixture
def fake_client_factory(monkeypatch):
    """Returns a (factory, session_holder) pair.

    factory(enter_delay=..., raise_on_enter=..., send_raises_on=...) installs
    FakeClient on gemini_live.genai.Client so GeminiLive.start() uses it. The
    fixture records the active FakeLiveSession on session_holder[0] so tests
    can drive it from outside.
    """
    import gemini_live

    session_holder: list[FakeLiveSession | None] = [None]

    def factory(
        *,
        enter_delay: float = 0.0,
        raise_on_enter: Exception | None = None,
        send_raises_on: Callable[[str, dict], bool] | None = None,
    ) -> FakeLiveSession:
        session = FakeLiveSession(
            enter_delay=enter_delay, send_raises_on=send_raises_on
        )
        session_holder[0] = session

        def _ctor(*args, **kwargs):
            return FakeClient(session=session, raise_on_enter=raise_on_enter)

        monkeypatch.setattr(gemini_live.genai, "Client", _ctor)
        return session

    return factory, session_holder


@pytest.fixture(autouse=True)
def byok_mode(monkeypatch):
    """Default to BYOK so start() doesn't try to fetch a hosted token.

    Individual tests override USE_HOSTED_API explicitly as needed.
    """
    monkeypatch.setenv("GEMINI_API_KEY", "fake-key-for-tests")
    monkeypatch.delenv("USE_HOSTED_API", raising=False)
    yield
