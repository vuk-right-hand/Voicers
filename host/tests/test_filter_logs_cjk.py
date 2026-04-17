"""
Cause J — CJK/Arabic hallucination filter must log at WARNING with a snippet.

Gemini occasionally hallucinates a short CJK or Arabic fragment in the
middle of an otherwise-English dictation stream — a known model quirk.
The `_HAS_LATIN_OR_DIGIT` regex silently drops those chunks, which is the
right behavior for UX but was a debugging black hole: the PWA shows
"nothing happened" and the host log had no signal that anything weird
was filtered.

Fix: rejections now log at WARNING with a snippet and a rejection counter.
On stop(), the counter appears in the session's summary log so we can
correlate "user reports flaky transcript" with "X silent rejections".

This test feeds a CJK-only transcription through the recv path and
verifies the WARNING fires with the snippet visible in the log message.

Run: cd host && venv/Scripts/python.exe -m pytest tests/test_filter_logs_cjk.py -v
"""
from __future__ import annotations

import asyncio
import logging

import pytest

import gemini_live
from tests.conftest import _FakeResponse


@pytest.mark.asyncio
async def test_cjk_only_transcription_logged_at_warning(
    fake_client_factory, caplog
):
    factory, _ = fake_client_factory
    session = factory()

    caplog.set_level(logging.WARNING, logger="gemini_live")

    transcripts: list[tuple[str, bool]] = []
    g = gemini_live.GeminiLive(
        on_transcript=lambda t, f: transcripts.append((t, f))
    )
    await g.start()

    # Feed a CJK-only hallucination. The text must contain zero Latin chars or
    # digits so _HAS_LATIN_OR_DIGIT rejects it.
    session.push_response(_FakeResponse(text="你好世界"))

    # Give _recv_loop a moment to process it.
    for _ in range(50):
        if g._filter_rejections > 0:
            break
        await asyncio.sleep(0.01)

    await g.stop()

    # Assertion 1: rejection counter advanced.
    assert g._filter_rejections == 1, (
        f"Expected 1 filter rejection, got {g._filter_rejections} — "
        "Cause J regression, CJK no longer filtered or not counted"
    )

    # Assertion 2: transcript callback was NOT called with the CJK text.
    for text, _ in transcripts:
        assert "你好世界" not in text, (
            "CJK hallucination leaked through the filter into the transcript"
        )

    # Assertion 3: WARNING log contains a snippet of the rejected text and
    # the rejection index (#1).
    warning_records = [
        r for r in caplog.records
        if r.levelno == logging.WARNING and "Non-Latin" in r.getMessage()
    ]
    assert len(warning_records) >= 1, (
        "No WARNING log emitted for CJK rejection — debugging black hole "
        "returns. All log records: "
        + repr([(r.levelname, r.getMessage()) for r in caplog.records])
    )

    msg = warning_records[0].getMessage()
    assert "你好世界" in msg, (
        f"WARNING log did not include a snippet of the rejected text: {msg!r}"
    )
    assert "#1" in msg, (
        f"WARNING log did not include the rejection index: {msg!r}"
    )


@pytest.mark.asyncio
async def test_latin_transcription_passes_through(fake_client_factory):
    """Complement: Latin text must NOT be filtered. Guards against a future
    overly-eager filter refactor silently dropping all transcripts."""
    factory, _ = fake_client_factory
    session = factory()

    transcripts: list[tuple[str, bool]] = []
    g = gemini_live.GeminiLive(
        on_transcript=lambda t, f: transcripts.append((t, f))
    )
    await g.start()

    session.push_response(_FakeResponse(text="hello world"))

    for _ in range(50):
        if transcripts:
            break
        await asyncio.sleep(0.01)

    await g.stop()

    assert g._filter_rejections == 0
    assert any("hello world" in t for t, _ in transcripts), (
        f"Latin transcript was filtered out — got {transcripts}"
    )
