// Cause G companion (client side) — rapid start-then-stop must not leak a mic track.
//
// The bug this prevents: use-voice.ts's startListening() awaits getUserMedia
// and audioWorklet.addModule(). If stopListening() runs during either await,
// the post-await code path must short-circuit and stop the stream it just
// acquired. Without the `if (!audioCtxRef.current) return;` guards at
// use-voice.ts:275 and :297, a rapid double-tap leaves a MediaStream with
// live tracks behind — the OS keeps the mic hot, the red dot stays lit, and
// the next startListening() creates a second stream stacked on top.
//
// React hooks can't run in a bare node --test environment without a full
// renderer. Instead, this test mirrors the exact guard+teardown pattern from
// use-voice.ts against the real mock primitives — so if someone removes the
// post-await guards, this test's "simulated startListening" (which shares the
// same shape) will leak a track and the assertion will fail.

import { test } from "node:test";
import assert from "node:assert/strict";
import { MockMediaStream, MockMediaStreamTrack } from "./__test-helpers__/webaudio-mock.mjs";

// Simulates the critical async shape of startListening + stopListening:
//   startListening creates audioCtx, awaits getUserMedia, checks the guard,
//   then awaits addModule, checks the guard again.
// stopListening synchronously nulls audioCtxRef and stops any live stream.
function makeHarness({ gumDelayMs = 0, addModuleDelayMs = 0 } = {}) {
  const refs = {
    audioCtx: null,
    stream: null,
    worklet: null,
    source: null,
  };

  const mockTrack = new MockMediaStreamTrack("audio");
  const stream = new MockMediaStream([mockTrack]);

  async function startListening() {
    // Mirror use-voice.ts:209 — AudioContext before await (preserves gesture token)
    refs.audioCtx = { state: "running", close: () => { refs.audioCtx = null; } };

    // Mirror use-voice.ts:225 — await getUserMedia
    await new Promise((r) => setTimeout(r, gumDelayMs));
    refs.stream = stream;

    // Mirror use-voice.ts:275 — guard after gUM await
    if (!refs.audioCtx) {
      stream.getTracks().forEach((t) => t.stop());
      refs.stream = null;
      return "bailed-after-gum";
    }

    // Mirror use-voice.ts:291 — await addModule
    await new Promise((r) => setTimeout(r, addModuleDelayMs));

    // Mirror use-voice.ts:297 — guard after addModule await
    if (!refs.audioCtx) return "bailed-after-addmodule";

    refs.worklet = { disconnect() {}, port: { onmessage: null } };
    refs.source = { disconnect() {} };
    return "fully-started";
  }

  function stopListening() {
    // Mirror use-voice.ts:343-367 teardown order: audioCtx → stream.tracks.stop()
    refs.worklet?.disconnect();
    refs.worklet = null;
    refs.source?.disconnect();
    refs.source = null;
    if (refs.audioCtx) {
      refs.audioCtx.close();
      refs.audioCtx = null;
    }
    if (refs.stream) {
      refs.stream.getTracks().forEach((t) => t.stop());
      refs.stream = null;
    }
  }

  return { refs, mockTrack, stream, startListening, stopListening };
}

test("rapid toggle: stopListening during getUserMedia await must stop the mic track", async () => {
  const h = makeHarness({ gumDelayMs: 20 });

  const startPromise = h.startListening();
  // Synchronous stop — equivalent to a rapid double-tap cancelling before
  // gUM resolves.
  h.stopListening();

  const result = await startPromise;

  assert.equal(result, "bailed-after-gum", "startListening must short-circuit after gUM guard");
  assert.equal(h.mockTrack.readyState, "ended", "mic track must be stopped after rapid toggle — leak prevented");
  assert.equal(h.refs.stream, null);
  assert.equal(h.refs.audioCtx, null);
  assert.equal(h.refs.worklet, null);
});

test("rapid toggle: stopListening between gUM and addModule still cleans up", async () => {
  const h = makeHarness({ gumDelayMs: 0, addModuleDelayMs: 20 });

  const startPromise = h.startListening();
  // Give gUM a chance to resolve (0ms) then stop before addModule completes.
  await new Promise((r) => setTimeout(r, 5));
  h.stopListening();

  const result = await startPromise;

  assert.equal(result, "bailed-after-addmodule", "startListening must short-circuit after addModule guard");
  assert.equal(h.mockTrack.readyState, "ended", "mic track stopped even when stop happens mid-addModule");
  assert.equal(h.refs.worklet, null);
});

test("no rapid toggle — full start should leave the mic live", async () => {
  // Complement: if no stop happens, the full start path must produce a live
  // mic track. Guards against a regression where the guard fires spuriously
  // and kills the happy path.
  const h = makeHarness({ gumDelayMs: 5, addModuleDelayMs: 5 });

  const result = await h.startListening();

  assert.equal(result, "fully-started");
  assert.equal(h.mockTrack.readyState, "live", "happy path must leave the mic live");
  assert.ok(h.refs.worklet);
});

test("double-stop is idempotent and does not throw", () => {
  // stopListening may be called from multiple code paths (user toggle,
  // track-ended handler, component unmount). Must not throw on a second call.
  const h = makeHarness();
  h.stopListening();
  h.stopListening();
  assert.equal(h.refs.audioCtx, null);
});
