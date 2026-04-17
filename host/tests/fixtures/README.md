# Test fixtures

## `voice_sample_16k.wav`

**Purpose:** real-API integration test — proves a pinned Gemini model can transcribe actual human speech end-to-end in both BYOK (v1beta) and hosted (v1alpha) modes.

**Why human, not synthetic:** `pyttsx3` wraps SAPI5 on Windows / espeak on Linux, defaults to 22050 Hz, and its robotic output often transcribes as nonsense on Gemini even at quality settings — the test would be nondeterministic per dev machine. A real human recording is deterministic, tiny (~150 KB), and licensing is clean because we recorded it ourselves.

### How to record

1. Use Audacity, a phone voice memo, or any clean recorder at **16 kHz mono**.
2. Say, with natural pauses:
   - **"one"** at approximately **t ≈ 0.1 s**
   - **"three"** at approximately **t ≈ 2.5 s** (this word must land during a forced-flush window — see the monkeypatched `_FLUSH_INTERVAL_S = 2.5` in the integration test)
   - **"five"** at approximately **t ≈ 4.9 s**
3. Total duration ~5 seconds.
4. Export as **16-bit PCM WAV, 16000 Hz, mono** — no compression, no metadata.
5. Save to `host/tests/fixtures/voice_sample_16k.wav`.
6. Verify timing with ffprobe:
   ```bash
   ffprobe -v error -show_entries packet=pts_time host/tests/fixtures/voice_sample_16k.wav
   ```
7. Commit to the repo.

### How to run

```bash
# BYOK mode (v1beta)
export GEMINI_API_KEY=...  # your personal key
export RUN_REAL_API_TESTS=1
cd host && venv/Scripts/python.exe -m pytest tests/test_gemini_real_integration.py -v

# Hosted mode (v1alpha)
# ...plus USE_HOSTED_API=true and the hosted-mode env (USER_ID, SUPABASE_SERVICE_ROLE_KEY)
```

Test is **skipped** if `RUN_REAL_API_TESTS` is unset or the WAV is missing.
