"""
Voice diagnostics (2026-10-27).

Field report: "STT stops showing text after 10-15 s, or doesn't work on the
next tap" — random, Android phone. Real-API replays showed the host + Gemini
pipeline healthy across flushes and re-taps, so the next occurrence must be
self-describing in voicer.log. These tests pin the ASR-stall detector:

  - warns once when ≥3 s of speech-level audio gets no transcript for >6 s
  - stays quiet during silence (pauses are not stalls)
  - stays quiet in the pre-warm window (no voice-tap yet)
  - logs recovery when transcripts resume, and re-arms for the next gap

Run: cd host && venv/Scripts/python.exe -m pytest tests/test_voice_diag.py -v
"""
from __future__ import annotations

import logging

import gemini_live

SPEECH = 0.1
SILENCE = 0.0001


def _live() -> gemini_live.GeminiLive:
    g = gemini_live.GeminiLive(on_transcript=lambda *a: None)
    g._turn_counter = 1
    g._last_transcript_ts = 100.0
    g._last_activity_start = 100.0
    return g


def _feed(g, start: float, seconds: float, rms: float) -> float:
    """Feed 100 ms chunks; returns the end timestamp."""
    t = start
    for _ in range(int(seconds * 10)):
        t += 0.1
        g._check_asr_stall(t, rms)
    return t


def _stalls(caplog) -> list[str]:
    return [r.getMessage() for r in caplog.records if "asr-stall" in r.getMessage()]


def test_speech_without_transcript_warns_once(caplog):
    caplog.set_level(logging.WARNING, logger="gemini_live")
    g = _live()
    _feed(g, 100.0, 15, SPEECH)
    assert len(_stalls(caplog)) == 1


def test_silence_is_not_a_stall(caplog):
    caplog.set_level(logging.WARNING, logger="gemini_live")
    g = _live()
    _feed(g, 100.0, 20, SILENCE)
    assert _stalls(caplog) == []


def test_short_speech_burst_in_long_gap_is_not_a_stall(caplog):
    """1 s of speech then silence: below the 3 s speech floor."""
    caplog.set_level(logging.WARNING, logger="gemini_live")
    g = _live()
    t = _feed(g, 100.0, 1, SPEECH)
    _feed(g, t, 10, SILENCE)
    assert _stalls(caplog) == []


def test_prewarm_window_is_ignored(caplog):
    caplog.set_level(logging.WARNING, logger="gemini_live")
    g = _live()
    g._turn_counter = 0
    _feed(g, 100.0, 15, SPEECH)
    assert _stalls(caplog) == []


def test_resume_is_logged_and_detector_rearms(caplog, monkeypatch):
    caplog.set_level(logging.WARNING, logger="gemini_live")
    g = _live()
    t = _feed(g, 100.0, 10, SPEECH)
    assert len(_stalls(caplog)) == 1

    monkeypatch.setattr(gemini_live.time, "monotonic", lambda: t)
    g._note_transcript()
    assert any("asr-resumed" in r.getMessage() for r in caplog.records)

    _feed(g, t, 10, SPEECH)
    assert len(_stalls(caplog)) == 2


def test_steady_transcripts_never_stall(caplog, monkeypatch):
    caplog.set_level(logging.WARNING, logger="gemini_live")
    g = _live()
    t = 100.0
    for _ in range(30):  # 30 s of speech, a transcript every second
        t = _feed(g, t, 1, SPEECH)
        monkeypatch.setattr(gemini_live.time, "monotonic", lambda t=t: t)
        g._note_transcript()
    assert _stalls(caplog) == []
