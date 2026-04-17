// Cause F — AudioContext sample-rate fallback.
//
// Pre-fix: `new AudioContext({ sampleRate: 16000 })` on Android Chrome /
// Pixel is silently ignored — the context runs at 48000. The old worklet
// emitted 1600 samples of 48 kHz data labelled `audio/pcm;rate=16000`.
// Gemini interpreted the 48 kHz data as 16 kHz → "audio plays ~3× too fast"
// → empty transcript. No client-side error. This was the likely cause of the
// "today nothing at all" failure on Pixel 7 Pro.
//
// Fix: the worklet reads `processorOptions.inputSampleRate`, and:
//   • bypass path (rate === 16000): direct Float32 → Int16 (iOS Safari).
//   • decimate path (rate !== 16000): 7-tap windowed-sinc FIR low-pass at
//     ≈ 7.5 kHz, then linear-interpolation resample with fractional-sample
//     `_phase` carryover across `process()` calls so chunk sizes don't drift
//     on non-integer ratios (44.1 kHz → 16 kHz).
//
// These tests exercise WORKLET_CODE directly via the sandboxed driver so we
// prove the signal-processing math is right without touching a real
// AudioContext or React runtime.
//
// Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { WORKLET_CODE } from "./voice-worklet.ts";
import { createWorkletDriver } from "./__test-helpers__/webaudio-mock.mjs";

// Collects every Int16Array produced by the worklet across many process() calls.
function totalSamplesEmitted(captured) {
  return captured.reduce((acc, buf) => acc + new Int16Array(buf).length, 0);
}

test("bypass path — 16 kHz input round-trips Float32 to Int16 unchanged", () => {
  const driver = createWorkletDriver(WORKLET_CODE, { inputSampleRate: 16000 });

  // 1600 samples = exactly one 100 ms chunk at 16 kHz.
  const input = new Float32Array(1600);
  for (let i = 0; i < input.length; i++) {
    input[i] = (i % 2 === 0 ? 0.5 : -0.5);
  }
  driver.feed(input);

  assert.equal(driver.captured.length, 1, "bypass path should emit one chunk per 100 ms");
  const out = new Int16Array(driver.captured[0]);
  assert.equal(out.length, 1600, "output must be exactly 1600 samples");

  // Int16Array truncates fractional assignments toward zero:
  //   0.5 * 0x7fff = 16383.5 → 16383
  //  -0.5 * 0x8000 = -16384   (exact integer)
  assert.equal(out[0], 16383);
  assert.equal(out[1], -16384);
});

test("Pixel path (48 kHz) — worklet produces output and stays within ±5% of 1600 samples/100ms budget", () => {
  const driver = createWorkletDriver(WORKLET_CODE, { inputSampleRate: 48000 });

  // Drive 10 chunks worth of input at the 48 kHz rate. inputTargetSize = 4800.
  const CHUNK = 4800;
  for (let k = 0; k < 10; k++) {
    const input = new Float32Array(CHUNK);
    for (let i = 0; i < CHUNK; i++) input[i] = Math.sin(i * 0.01) * 0.1;
    driver.feed(input);
  }

  assert.ok(driver.captured.length >= 10, `expected ≥10 emitted chunks, got ${driver.captured.length}`);

  // 10 × 100 ms of 16 kHz output ≈ 16 000 samples. Must stay inside ±5 %
  // regardless of accumulated phase drift — the carry-over is what we're
  // proving here.
  const total = totalSamplesEmitted(driver.captured);
  const expected = 16000;
  const drift = Math.abs(total - expected) / expected;
  assert.ok(
    drift < 0.05,
    `total output ${total} drifted ${(drift * 100).toFixed(2)}% from ${expected} — phase carryover regression`,
  );
});

test("non-integer ratio (44.1 kHz) — total output stays within ±5 % of expected over 10 chunks", () => {
  // 44100 → 16000 ratio ≈ 2.75625. `_phase` must carry fractional samples
  // across calls or the output drifts by tens of samples per 100 ms.
  const driver = createWorkletDriver(WORKLET_CODE, { inputSampleRate: 44100 });

  const CHUNK = Math.round(44100 * 0.1); // 4410
  for (let k = 0; k < 10; k++) {
    const input = new Float32Array(CHUNK);
    for (let i = 0; i < CHUNK; i++) input[i] = Math.sin(i * 0.02) * 0.1;
    driver.feed(input);
  }

  const total = totalSamplesEmitted(driver.captured);
  const expected = 16000; // 10 × 100 ms at 16 kHz output
  const drift = Math.abs(total - expected) / expected;
  assert.ok(
    drift < 0.05,
    `44.1k→16k total=${total} drifted ${(drift * 100).toFixed(2)}% from ${expected} — non-integer ratio handling broken`,
  );
});

test("anti-alias filter attenuates above-Nyquist content vs naive decimation", () => {
  // Aliasing proof. A 10 kHz sine fed at 48 kHz input, when decimated to
  // 16 kHz WITHOUT filtering, folds back into the pass band (10 kHz →
  // |10 − 16| = 6 kHz) at full amplitude — raw decimation passes it straight
  // through. Our FIR-then-decimate pipeline must attenuate it MORE than
  // naive decimation would, at the same input. We compare directly against
  // a reference naive-decimate implementation so the assertion measures the
  // filter's work, not absolute signal levels (which depend on FIR length,
  // a tunable we may revisit).
  //
  // This is also the most honest test — it catches a regression where
  // someone accidentally reverts to `take every 3rd sample`, which would
  // make the RMS ratio approach 1.0 and fail the ≤ 0.5 bound.

  const driver = createWorkletDriver(WORKLET_CODE, { inputSampleRate: 48000 });

  const N = 48000;
  const input = new Float32Array(N);
  for (let i = 0; i < N; i++) input[i] = Math.sin(2 * Math.PI * 10000 * i / 48000);

  const CHUNK = 4800;
  for (let offset = 0; offset < N; offset += CHUNK) {
    driver.feed(input.subarray(offset, offset + CHUNK));
  }

  // Filtered pipeline RMS.
  let sumSq = 0;
  let count = 0;
  for (const buf of driver.captured) {
    const i16 = new Int16Array(buf);
    for (let i = 0; i < i16.length; i++) {
      const s = i16[i] / (i16[i] < 0 ? 0x8000 : 0x7fff);
      sumSq += s * s;
      count += 1;
    }
  }
  const filteredRms = Math.sqrt(sumSq / count);

  // Naive reference — take every 3rd sample, no filter. This is what the
  // pipeline used to do.
  let naiveSumSq = 0;
  let naiveCount = 0;
  for (let i = 0; i < N; i += 3) {
    naiveSumSq += input[i] * input[i];
    naiveCount += 1;
  }
  const naiveRms = Math.sqrt(naiveSumSq / naiveCount);

  const ratio = filteredRms / naiveRms;
  const attenDb = 20 * Math.log10(ratio);
  assert.ok(
    ratio < 0.5,
    `FIR+decimate only attenuated 10 kHz content by ${attenDb.toFixed(1)} dB vs naive ` +
    `decimation (ratio=${ratio.toFixed(3)}). Regression: anti-alias filter is not biting. ` +
    `Raw decimation would pass 10 kHz through as 6 kHz and poison ASR.`,
  );
});

test("Bluetooth-mid-session — driver can be rebuilt with a different inputSampleRate", () => {
  // The plan calls for use-voice.ts's `onended` handler to re-request
  // getUserMedia and rebuild the worklet with the new inputSampleRate.
  // Here we prove the worklet class itself can be instantiated cleanly at
  // any rate — so rebuilding during a Bluetooth switch succeeds.

  const at48 = createWorkletDriver(WORKLET_CODE, { inputSampleRate: 48000 });
  at48.feed(new Float32Array(4800));
  at48.feed(new Float32Array(4800));
  assert.ok(at48.captured.length >= 2, "48 kHz driver must emit after 2 chunks");

  // Simulate a Bluetooth connect mid-session: a fresh driver at 44100.
  const at441 = createWorkletDriver(WORKLET_CODE, { inputSampleRate: 44100 });
  at441.feed(new Float32Array(4410));
  at441.feed(new Float32Array(4410));
  assert.ok(at441.captured.length >= 2, "44.1 kHz rebuild driver must emit after 2 chunks");
});
