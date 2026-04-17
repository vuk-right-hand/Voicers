"""
Real-API regression-seal — the one test that catches Google-side model
rotations, broken pins, or WebSocket API-version breakage.

This test replays a committed human-recorded WAV through the real
GeminiLive pipeline end-to-end. It exercises Causes A + B + C + E
simultaneously:
  - A (boot race): if the `_active` flag still lags behind `await`, the
    first word ("one") is dropped from the transcript.
  - B (activity lock): if the flush_loop still brackets audio-send calls
    with a window gap, the middle word ("three") — positioned at t ≈ 2.5 s
    to land during the monkeypatched flush — is discarded server-side.
  - C (flush_final): if voice-stop doesn't wait for the tail transcription,
    the last word ("five") is missing.
  - E (model pin): if the pinned model ID has rotated or deprecated, Gemini
    returns nothing or an error.

This is the only test that would have caught today's "nothing at all"
failure if it had been running in CI.

Opt-in via BOTH env vars:
  RUN_REAL_API_TESTS=1
  GEMINI_API_KEY=<your key>

Parameterized across BYOK (v1beta) and hosted (v1alpha) — the pinned
model must work in both API versions. This also serves as the ownership
mechanism for step 2's "pre-ship verification" question: any PR that
changes the model pin or API version runs this test in both modes.

Run:
  # BYOK only
  RUN_REAL_API_TESTS=1 GEMINI_API_KEY=... \\
    cd host && venv/Scripts/python.exe -m pytest \\
      tests/test_gemini_real_integration.py -v

  # Hosted (also requires USER_ID + SUPABASE_SERVICE_ROLE_KEY)
  RUN_REAL_API_TESTS=1 USE_HOSTED_API=true GEMINI_API_KEY=... \\
    USER_ID=... SUPABASE_SERVICE_ROLE_KEY=... \\
    cd host && venv/Scripts/python.exe -m pytest \\
      tests/test_gemini_real_integration.py -v
"""
from __future__ import annotations

import asyncio
import os
import wave
from pathlib import Path

import pytest

import gemini_live


FIXTURE = Path(__file__).parent / "fixtures" / "voice_sample_16k.wav"
TARGET_WORDS = ("one", "three", "five")

# 100 ms chunks at 16 kHz mono 16-bit PCM = 1600 samples = 3200 bytes.
CHUNK_BYTES = 3200
CHUNK_MS = 100


pytestmark = pytest.mark.real_api


def _should_skip() -> tuple[bool, str]:
    if os.environ.get("RUN_REAL_API_TESTS") != "1":
        return True, "RUN_REAL_API_TESTS != 1 — opt-in only"
    if not os.environ.get("GEMINI_API_KEY"):
        return True, "GEMINI_API_KEY not set"
    if not FIXTURE.exists():
        return True, (
            f"Fixture missing at {FIXTURE}. See "
            f"{FIXTURE.parent / 'README.md'} for recording instructions."
        )
    return False, ""


def _load_pcm_chunks() -> list[bytes]:
    """Load the fixture WAV and split into 100 ms chunks.

    Validates the WAV is 16 kHz mono 16-bit so we catch a miscut fixture
    early instead of letting Gemini silently garble it.
    """
    with wave.open(str(FIXTURE), "rb") as wf:
        assert wf.getframerate() == 16000, f"Fixture must be 16 kHz, got {wf.getframerate()}"
        assert wf.getnchannels() == 1, f"Fixture must be mono, got {wf.getnchannels()} channels"
        assert wf.getsampwidth() == 2, f"Fixture must be 16-bit PCM, got {wf.getsampwidth() * 8}-bit"
        pcm = wf.readframes(wf.getnframes())

    chunks: list[bytes] = []
    for offset in range(0, len(pcm), CHUNK_BYTES):
        chunk = pcm[offset:offset + CHUNK_BYTES]
        if chunk:
            chunks.append(chunk)
    return chunks


@pytest.fixture
def integration_mode(request, monkeypatch):
    """Switches env between BYOK (v1beta) and hosted (v1alpha).

    Hosted mode additionally requires USER_ID + SUPABASE_SERVICE_ROLE_KEY —
    if those are missing, we skip the hosted sub-case rather than failing,
    because a BYOK-only contributor should still be able to land a change.
    """
    mode = request.param
    if mode == "hosted":
        if not os.environ.get("USER_ID") or not os.environ.get("SUPABASE_SERVICE_ROLE_KEY"):
            pytest.skip(
                "Hosted-mode integration test needs USER_ID + "
                "SUPABASE_SERVICE_ROLE_KEY in the environment"
            )
        monkeypatch.setenv("USE_HOSTED_API", "true")
    else:
        monkeypatch.delenv("USE_HOSTED_API", raising=False)
    return mode


@pytest.mark.asyncio
@pytest.mark.parametrize("integration_mode", ["byok", "hosted"], indirect=True)
async def test_real_gemini_transcribes_target_words(integration_mode, monkeypatch):
    skip, reason = _should_skip()
    if skip:
        pytest.skip(reason)

    # Shrink flush interval so the middle word ("three" at ~2.5 s) lands
    # during a forced flush — proves Cause B fix (activity lock) end-to-end.
    # Using monkeypatch keeps this test-only; no production code leaks.
    monkeypatch.setattr(gemini_live, "_FLUSH_INTERVAL_S", 2.5)

    transcripts: list[tuple[str, bool]] = []

    def _capture(text: str, is_final: bool) -> None:
        transcripts.append((text, is_final))

    chunks = _load_pcm_chunks()

    g = gemini_live.GeminiLive(on_transcript=_capture)
    await g.start()

    try:
        # Pace chunks in real time — Gemini tolerates faster but this mirrors
        # how WebRTC would actually feed them and exposes any timing-sensitive
        # regressions.
        for chunk in chunks:
            await g.send_audio(chunk)
            await asyncio.sleep(CHUNK_MS / 1000)

        # Final flush — drains queue, sends activity_end, waits for the tail
        # transcription. This is Cause C's fix path.
        final_text = await g.flush_final(timeout=3.0)
    finally:
        await g.stop()

    # Concatenate everything the model emitted — interim + final + on_transcript
    # callbacks — and match case-insensitively. Gemini's formatting varies
    # (punctuation, capitalization) so substring matching is the safe assertion.
    combined = (final_text + " " + " ".join(t for t, _ in transcripts)).lower()

    missing = [w for w in TARGET_WORDS if w not in combined]
    assert not missing, (
        f"Real-API transcription missing words {missing} in mode={integration_mode}. "
        f"Full combined output: {combined!r}. "
        f"Likely causes: model pin rotated ({gemini_live.MODEL}), "
        f"API version mismatch, or one of Causes A/B/C regressed."
    )
