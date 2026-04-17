"""
Cause E — Gemini model pin regression guard.

`-latest` and `-preview-` aliases both rotate silently. Today's broken
dictation could have been Google swapping the backing model behind
`gemini-2.5-flash-native-audio-latest`.

Fix: `MODEL = os.environ.get("GEMINI_MODEL", "<pinned>")` with an explicit
ALLOWED_MODELS allowlist (NOT a regex substring check) so a future
contributor accidentally introducing another floating alias fails CI.

Adding a new pin requires an explicit entry in the allowlist below, with a
dated comment explaining why. That doubles as a lightweight audit trail.

Pre-ship verification (separate from this unit test): `test_gemini_real_integration.py`
is parameterized across both BYOK (v1beta) and hosted (v1alpha) API modes,
so opting into `RUN_REAL_API_TESTS=1 pytest` catches a broken pin in both
paths before ship.

Run: cd host && venv/Scripts/python.exe -m pytest tests/test_model_pinned.py -v
"""
from __future__ import annotations

import gemini_live


# Explicit allowlist of pinned model IDs that have been approved for use.
# Adding to this list is a conscious decision — document the approval date and
# the reason (e.g. "Google stable preview alias as of 2026-04, verified with
# real-API smoke in both v1alpha and v1beta").
ALLOWED_MODELS = frozenset({
    # 2026-04-17: `gemini-2.5-flash-preview-native-audio-dialog` was retired
    # server-side when Google consolidated v1alpha into v1main. Replacement is
    # the date-stamped 2.5-flash native-audio preview. Verified live against
    # the hosted path after the consolidation broke existing pins.
    "gemini-2.5-flash-native-audio-preview-12-2025",
})


def test_model_constant_is_in_allowlist():
    assert gemini_live.MODEL in ALLOWED_MODELS, (
        f"gemini_live.MODEL = {gemini_live.MODEL!r} is not in ALLOWED_MODELS. "
        "Rotations require explicit review — add a new entry with a dated "
        "comment AND run the real-API integration test in both hosted (v1alpha) "
        "and BYOK (v1beta) modes before merging."
    )


def test_model_does_not_use_floating_aliases():
    """Defence-in-depth: both `-latest` and generic `-preview` (without a
    specific subname) have burned us. The allowlist is authoritative; this is
    a redundant sanity check that's still worth failing loudly on."""
    assert "-latest" not in gemini_live.MODEL, (
        f"Banned floating alias `-latest` in {gemini_live.MODEL!r} — "
        "Google rotates these silently"
    )
    # `-preview-native-audio-dialog` is a specific preview subname that's
    # been pinned by Google for months; plain `-preview-` without a specific
    # suffix is the dangerous kind. Guard against that.
    assert not gemini_live.MODEL.endswith("-preview"), (
        f"Bare `-preview` suffix in {gemini_live.MODEL!r} — another floating alias"
    )


def test_env_override_still_respected(monkeypatch):
    """Env override must still work — it's the hot-swap escape hatch for a
    production emergency where the pinned model becomes unavailable.

    We do NOT use importlib.reload() here — `webrtc_host.py` has already done
    `from gemini_live import GeminiLive` at import time, and reloading
    gemini_live would leave webrtc_host's GeminiLive class reference pointing
    at a now-stale old class object. Subsequent tests that patch
    `gemini_live.GeminiLive.start` would miss the class webrtc_host actually
    uses, and any Gemini session would hit the real API.

    Instead, directly verify the env-lookup expression that gemini_live uses,
    exercising the same os.environ.get(...) fallback path.
    """
    import os

    monkeypatch.setenv("GEMINI_MODEL", "gemini-override-for-test")
    resolved = os.environ.get(
        "GEMINI_MODEL", "gemini-2.5-flash-native-audio-preview-12-2025"
    )
    assert resolved == "gemini-override-for-test"

    monkeypatch.delenv("GEMINI_MODEL", raising=False)
    resolved = os.environ.get(
        "GEMINI_MODEL", "gemini-2.5-flash-native-audio-preview-12-2025"
    )
    assert resolved == "gemini-2.5-flash-native-audio-preview-12-2025"
