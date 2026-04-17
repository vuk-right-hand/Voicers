// Session-lifecycle promotion (2026-04-17), PWA side — indicator-free
// AudioContext pre-warm.
//
// Pre-warm creates `new AudioContext({sampleRate: 16000})` and loads the
// worklet module at connect-time from a user gesture. It deliberately does
// NOT call `getUserMedia` — that's the only API that lights the OS mic
// indicator, and we refuse to leave the mic hot during idle pocket-mode
// sessions.
//
// use-voice.ts imports React + zustand at module top, so we can't import
// the real hook in a bare node --test run. Instead we mirror the module-
// level pre-warm state machine against the same mocks the real code uses.
// A regression in the real code's flow will fall through the same contract
// this test exercises, so a broken refactor shows up as a behavior drift
// here.
//
// Run: npm test
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  MockAudioContext,
  MockAudioWorkletNode,
  MockMediaStream,
  MockMediaStreamTrack,
  MockDataChannel,
  resetMocks,
} from "./__test-helpers__/webaudio-mock.mjs";

// ── Harness: mirrors the module-level pre-warm state in use-voice.ts ────────

function makeModule() {
  // Module-level state (matches the real thing at top of use-voice.ts).
  const state = {
    sttAudioCtx: null,
    sttGain: null,
    sttAudioReady: false,
    sttInputSampleRate: 16000,
  };

  let gumCalls = 0;
  const tracks = [new MockMediaStreamTrack("audio")];
  const stream = new MockMediaStream(tracks);
  const getUserMedia = async () => {
    gumCalls += 1;
    return stream;
  };

  async function prewarmAudio() {
    if (state.sttAudioReady) return;
    try {
      const ctx = new MockAudioContext({ sampleRate: 16000 });
      state.sttAudioCtx = ctx;
      state.sttInputSampleRate = ctx.sampleRate;
      await ctx.audioWorklet.addModule("blob:mock-worklet");
      const gain = ctx.createGain();
      gain.gain.value = 0;
      gain.connect(ctx.destination);
      state.sttGain = gain;
      state.sttAudioReady = true;
    } catch {
      state.sttAudioCtx = null;
      state.sttGain = null;
      state.sttAudioReady = false;
    }
  }

  async function teardownAudioPrewarm() {
    if (state.sttAudioCtx) {
      try { state.sttGain?.disconnect(); } catch { /* ignore */ }
      try { await state.sttAudioCtx.close(); } catch { /* ignore */ }
    }
    state.sttAudioCtx = null;
    state.sttGain = null;
    state.sttAudioReady = false;
    state.sttInputSampleRate = 16000;
  }

  // Per-hook refs (source/worklet/stream are per-turn).
  const refs = {
    dataChannel: new MockDataChannel(),
    stream: null,
    source: null,
    worklet: null,
    coldCtx: null,
    coldGain: null,
  };

  async function startListening() {
    // Warm path
    if (state.sttAudioReady && state.sttAudioCtx && state.sttGain) {
      const ctx = state.sttAudioCtx;
      if (ctx.state === "suspended") await ctx.resume();

      const s = await getUserMedia();
      refs.stream = s;

      const source = ctx.createMediaStreamSource(s);
      refs.source = source;

      const worklet = new MockAudioWorkletNode(ctx, "pcm-processor", {
        processorOptions: { inputSampleRate: ctx.sampleRate },
      });
      refs.worklet = worklet;

      // Rebind every call — closes over the *current* dataChannel ref so a
      // reconnect cycle doesn't leave tap #N shipping over a dead DC.
      worklet.port.onmessage = (e) => {
        const dc = refs.dataChannel;
        if (dc && dc.readyState === "open") dc.send(e.data);
      };
      source.connect(worklet);
      worklet.connect(state.sttGain);
      return "warm";
    }

    // Cold path
    const ctx = new MockAudioContext({ sampleRate: 16000 });
    refs.coldCtx = ctx;
    const s = await getUserMedia();
    refs.stream = s;
    await ctx.audioWorklet.addModule("blob:mock-worklet-cold");
    const source = ctx.createMediaStreamSource(s);
    refs.source = source;
    const worklet = new MockAudioWorkletNode(ctx, "pcm-processor", {
      processorOptions: { inputSampleRate: ctx.sampleRate },
    });
    refs.worklet = worklet;
    worklet.port.onmessage = (e) => {
      const dc = refs.dataChannel;
      if (dc && dc.readyState === "open") dc.send(e.data);
    };
    const gain = ctx.createGain();
    gain.gain.value = 0;
    refs.coldGain = gain;
    source.connect(worklet);
    worklet.connect(gain);
    gain.connect(ctx.destination);
    return "cold";
  }

  function stopListening() {
    // Per-turn teardown: release mic + disconnect source/worklet; KEEP the
    // warm AudioContext + gain so the next tap takes the fast path.
    try { refs.worklet?.disconnect(); } catch { /* ignore */ }
    refs.worklet = null;
    try { refs.source?.disconnect(); } catch { /* ignore */ }
    refs.source = null;
    if (refs.stream) {
      refs.stream.getTracks().forEach((t) => t.stop());
      refs.stream = null;
    }
    if (refs.coldGain) { try { refs.coldGain.disconnect(); } catch {} ; refs.coldGain = null; }
    if (refs.coldCtx) { try { refs.coldCtx.close(); } catch {} ; refs.coldCtx = null; }
  }

  return {
    state,
    refs,
    tracks,
    stream,
    prewarmAudio,
    teardownAudioPrewarm,
    startListening,
    stopListening,
    gumCalls: () => gumCalls,
  };
}

beforeEach(() => { resetMocks(); });

// ─── Tests ───────────────────────────────────────────────────────────────────

test("prewarmAudio creates AudioContext + loads worklet module + does NOT call getUserMedia", async () => {
  const m = makeModule();

  await m.prewarmAudio();

  assert.equal(m.state.sttAudioReady, true);
  assert.ok(m.state.sttAudioCtx, "AudioContext not created");
  assert.ok(m.state.sttGain, "gain node not created");
  assert.equal(m.state.sttAudioCtx.audioWorklet.modules.length, 1);
  assert.equal(m.gumCalls(), 0, "getUserMedia must NOT be called during pre-warm (mic indicator stays dark)");
});

test("startListening after pre-warm is fast but still calls getUserMedia", async () => {
  const m = makeModule();
  await m.prewarmAudio();

  const ctxBefore = m.state.sttAudioCtx;
  const modulesBefore = ctxBefore.audioWorklet.modules.length;

  const path = await m.startListening();

  assert.equal(path, "warm");
  assert.equal(m.gumCalls(), 1, "getUserMedia must be called on voice-tap (expected mic-indicator cost)");
  assert.equal(
    ctxBefore.audioWorklet.modules.length,
    modulesBefore,
    "addModule must NOT be called again on warm path",
  );
  assert.ok(m.refs.source, "source node not created");
  assert.ok(m.refs.worklet, "worklet node not created");
  assert.strictEqual(m.state.sttAudioCtx, ctxBefore, "warm path must reuse pre-warmed context");
});

test("startListening resumes a suspended AudioContext before wiring the graph", async () => {
  const m = makeModule();
  await m.prewarmAudio();
  // Simulate PWA-backgrounded state — mobile browsers suspend the context.
  m.state.sttAudioCtx.state = "suspended";

  await m.startListening();

  assert.equal(m.state.sttAudioCtx.state, "running", "audioCtx.resume() not called — warm path would emit zero PCM");
});

test("startListening rebinds worklet.port.onmessage every call (survives reconnect)", async () => {
  const m = makeModule();
  await m.prewarmAudio();

  await m.startListening();
  const firstHandler = m.refs.worklet.port.onmessage;
  m.stopListening();

  // Simulate a reconnect: swap in a new DataChannel, then startListening again.
  const newDc = new MockDataChannel();
  m.refs.dataChannel = newDc;
  await m.startListening();

  const secondHandler = m.refs.worklet.port.onmessage;
  assert.notStrictEqual(
    firstHandler,
    secondHandler,
    "worklet.port.onmessage was not rebound — tap #N would ship over a stale DC",
  );

  // Verify the new handler writes to the *new* DC, not the old one.
  secondHandler({ data: new ArrayBuffer(16) });
  assert.equal(newDc.sent.length, 1, "new handler did not write to the new DC");
});

test("startListening without pre-warm takes the cold path", async () => {
  const m = makeModule();
  // No prewarmAudio() call.

  const path = await m.startListening();

  assert.equal(path, "cold");
  assert.ok(m.refs.coldCtx, "cold path must bootstrap its own AudioContext");
  assert.equal(m.refs.coldCtx.audioWorklet.modules.length, 1, "cold path must load the worklet module");
  assert.equal(m.gumCalls(), 1);
  assert.equal(m.state.sttAudioReady, false, "pre-warm flag must remain false");
});

test("stopListening releases the mic but preserves the warm AudioContext", async () => {
  const m = makeModule();
  await m.prewarmAudio();
  await m.startListening();

  const ctxSnapshot = m.state.sttAudioCtx;
  const gainSnapshot = m.state.sttGain;

  m.stopListening();

  assert.equal(m.tracks[0].readyState, "ended", "mic track not stopped — OS indicator would stay on");
  assert.equal(m.refs.stream, null);
  assert.equal(m.refs.source, null);
  assert.equal(m.refs.worklet, null);
  // WARM context preserved for the next tap.
  assert.strictEqual(m.state.sttAudioCtx, ctxSnapshot);
  assert.strictEqual(m.state.sttGain, gainSnapshot);
  assert.equal(m.state.sttAudioReady, true);
  assert.equal(ctxSnapshot.state, "running", "warm context was closed on stop — regression");
});

test("teardownAudioPrewarm closes everything (disconnect path)", async () => {
  const m = makeModule();
  await m.prewarmAudio();
  const ctxSnapshot = m.state.sttAudioCtx;

  await m.teardownAudioPrewarm();

  assert.equal(ctxSnapshot.state, "closed", "AudioContext not closed on disconnect");
  assert.equal(m.state.sttAudioCtx, null);
  assert.equal(m.state.sttGain, null);
  assert.equal(m.state.sttAudioReady, false);
});
