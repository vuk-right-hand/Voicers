// Standalone AudioWorklet source + pure helpers.
//
// Extracted from use-voice.ts so the unit test suite can import them without
// dragging in React or Next.js path aliases. Do not add React/Next imports here.

// ─── Inline AudioWorklet processor (avoids Next.js compilation issues) ──────
//
// Two paths:
//   • sampleRate === 16000 (iOS Safari honors our request): bypass — direct
//     Float32 → Int16 at 1600 samples per 100 ms chunk.
//   • sampleRate !== 16000 (Android Chrome / Pixel, WebView): anti-alias then
//     decimate to exactly 1600 output samples per chunk.
//
// 7-tap windowed-sinc FIR low-pass at ≈7.5 kHz cutoff (Hann window).
// Fractional-sample `_phase` carryover across process() calls guarantees
// exactly 1600 output samples per postMessage even for non-integer ratios
// (44.1k → 16k).

export const WORKLET_CODE = `
class PCMProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = (options && options.processorOptions) || {};
    this._init(opts);
  }

  _init(opts) {
    // Input sample rate as seen by this AudioContext. On Pixel 7 Pro / Android
    // Chrome this is 48000 even when we asked for 16000.
    this._inputRate = (opts && opts.inputSampleRate) || sampleRate || 48000;
    this._outputRate = 16000;
    this._needsDecimate = this._inputRate !== this._outputRate;

    // 100 ms worth of INPUT samples before we flush. Output is always 1600.
    this._inputTargetSize = Math.round(this._inputRate * 0.1);
    this._outputTargetSize = 1600;

    this._inputBuffer = [];
    this._inputBufferSize = 0;

    // FIR low-pass, windowed-sinc, cutoff ≈ 7500 Hz at any input rate.
    // Coefficients computed once here (symmetric, 7 taps).
    this._fir = this._computeFir(7, 7500, this._inputRate);
    this._firState = new Float32Array(this._fir.length - 1);

    // Fractional-sample phase carryover for non-integer ratios.
    this._phase = 0;
    this._ratio = this._inputRate / this._outputRate;
  }

  _computeFir(n, cutoffHz, inputRate) {
    const taps = new Float32Array(n);
    const mid = (n - 1) / 2;
    const fc = cutoffHz / inputRate; // normalized
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const k = i - mid;
      const sinc = k === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * k) / (Math.PI * k);
      const hann = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
      taps[i] = sinc * hann;
      sum += taps[i];
    }
    for (let i = 0; i < n; i++) taps[i] /= sum; // unity DC gain
    return taps;
  }

  _filter(input) {
    // Straight FIR on the concatenated (prev-state + input) stream.
    const fir = this._fir;
    const stateLen = this._firState.length;
    const total = stateLen + input.length;
    const scratch = new Float32Array(total);
    scratch.set(this._firState, 0);
    scratch.set(input, stateLen);
    const out = new Float32Array(input.length);
    for (let i = 0; i < input.length; i++) {
      let acc = 0;
      for (let j = 0; j < fir.length; j++) acc += scratch[i + j] * fir[j];
      out[i] = acc;
    }
    // Save last (taps-1) samples for next call.
    this._firState.set(scratch.subarray(total - stateLen), 0);
    return out;
  }

  _resampleTo16k(filtered) {
    // Linear interpolation at fractional phase \`this._phase\`. Emits as many
    // output samples as fit, carries remainder to next chunk.
    const ratio = this._ratio;
    const out = [];
    let phase = this._phase;
    while (phase < filtered.length - 1) {
      const i = phase | 0;
      const frac = phase - i;
      out.push(filtered[i] * (1 - frac) + filtered[i + 1] * frac);
      phase += ratio;
    }
    this._phase = phase - filtered.length;
    return out;
  }

  _emit(float32Out) {
    const int16 = new Int16Array(float32Out.length);
    for (let i = 0; i < float32Out.length; i++) {
      const s = Math.max(-1, Math.min(1, float32Out[i]));
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    this.port.postMessage(int16.buffer, [int16.buffer]);
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const samples = input[0];
    this._inputBuffer.push(new Float32Array(samples));
    this._inputBufferSize += samples.length;

    if (this._inputBufferSize < this._inputTargetSize) return true;

    // Merge buffered input.
    const merged = new Float32Array(this._inputBufferSize);
    let offset = 0;
    for (const chunk of this._inputBuffer) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    this._inputBuffer = [];
    this._inputBufferSize = 0;

    if (!this._needsDecimate) {
      // Bypass path — no filter, no resample. Matches iOS Safari behaviour.
      this._emit(merged);
      return true;
    }

    const filtered = this._filter(merged);
    const resampled = this._resampleTo16k(filtered);
    if (resampled.length > 0) this._emit(Float32Array.from(resampled));
    return true;
  }
}

registerProcessor("pcm-processor", PCMProcessor);
`;

// ─── Error reason → user-facing copy ───────────────────────────────────────

export function friendlyMessageFor(reason: string | undefined): string {
  switch (reason) {
    case "token": return "Auth failed — check your subscription or API key";
    case "model": return "Voice model unavailable — please update the app";
    case "handshake": return "Voice server unreachable — try again";
    case "no-audio": return "No mic input — check mic permission";
    default: return "Voice session failed — try again";
  }
}
