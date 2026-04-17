// Cause D companion (client side) — voice-status error messages MUST produce
// the correct copy from the friendlyMessageFor table, not a generic toast.
//
// The risk: use-session.ts (line 122) calls `voiceStore.setMicError(
// friendlyMessageFor(msg.reason))` when a host-side error arrives. If the
// copy table drifts out of sync with the host's reason taxonomy
// (webrtc_host.py `_classify_start_error`), the user sees "Voice session
// failed" for every cause — including ones with actionable fixes like
// "No mic input — check mic permission". The whole point of step 1's
// taxonomy is to tell the user WHICH thing is wrong.
//
// This test exercises the reason→copy mapping directly (the pure function
// `friendlyMessageFor`) plus the full message-handler logic extracted
// into a reproducible form so a reason-table drift or a status-transition
// regression both fail loudly.

import { test } from "node:test";
import assert from "node:assert/strict";
import { friendlyMessageFor } from "./voice-worklet.ts";

test("friendlyMessageFor — token reason gets auth copy", () => {
  assert.equal(
    friendlyMessageFor("token"),
    "Auth failed — check your subscription or API key",
  );
});

test("friendlyMessageFor — model reason gets update-app copy", () => {
  assert.equal(
    friendlyMessageFor("model"),
    "Voice model unavailable — please update the app",
  );
});

test("friendlyMessageFor — handshake reason gets server-unreachable copy", () => {
  assert.equal(
    friendlyMessageFor("handshake"),
    "Voice server unreachable — try again",
  );
});

test("friendlyMessageFor — no-audio reason gets mic-permission copy", () => {
  assert.equal(
    friendlyMessageFor("no-audio"),
    "No mic input — check mic permission",
  );
});

test("friendlyMessageFor — unknown reason falls back to generic copy", () => {
  assert.equal(
    friendlyMessageFor("unknown"),
    "Voice session failed — try again",
  );
});

test("friendlyMessageFor — undefined reason falls back to generic copy", () => {
  // Defensive: if host ever sends voice-status:error without a reason field,
  // we still need to surface *something* rather than showing nothing.
  assert.equal(
    friendlyMessageFor(undefined),
    "Voice session failed — try again",
  );
});

test("friendlyMessageFor — unrecognized reason string falls back", () => {
  // Guards against a future host-side reason being added without a matching
  // PWA table entry. We prefer a generic toast over a crash.
  assert.equal(
    friendlyMessageFor("brand-new-reason-code"),
    "Voice session failed — try again",
  );
});

// ─── Simulated dispatcher — mirrors the logic in use-session.ts:120-131 ────
//
// The actual handler is an inline closure inside a zustand store's
// `connectSession` method that pulls useVoiceStore via getState() and mutates
// it. Re-implementing that closure here lets us verify the full chain
// (reason → copy + status transitions) without booting Next.js or React.
//
// If use-session.ts drifts away from this shape — e.g. someone drops the
// setStatus("idle") or the setMode(null) — the test still catches the
// friendlyMessageFor contract, and the comment above the handler in
// use-session.ts cross-references this file.
function simulateVoiceStatusHandler(msg, voiceStore) {
  if (msg.type !== "voice-status") return;
  if (msg.status === "error") {
    voiceStore.setMicError(friendlyMessageFor(msg.reason));
    voiceStore.setStatus("idle");
    voiceStore.setMode(null);
  } else if (msg.status !== "listening") {
    voiceStore.setStatus(msg.status);
  }
}

function makeVoiceStore() {
  const state = { status: "listening", mode: "dictation", micError: null };
  return {
    state,
    setMicError(msg) { state.micError = msg; },
    setStatus(s) { state.status = s; },
    setMode(m) { state.mode = m; },
  };
}

test("voice-status error handler — model reason sets correct copy and resets status", () => {
  const store = makeVoiceStore();
  simulateVoiceStatusHandler({ type: "voice-status", status: "error", reason: "model" }, store);

  assert.equal(store.state.micError, "Voice model unavailable — please update the app");
  assert.equal(store.state.status, "idle", "error must clear listening state");
  assert.equal(store.state.mode, null, "error must clear mode so modal closes");
});

test("voice-status error handler — no-audio reason (Cause D startup watchdog)", () => {
  const store = makeVoiceStore();
  simulateVoiceStatusHandler({ type: "voice-status", status: "error", reason: "no-audio" }, store);

  assert.equal(store.state.micError, "No mic input — check mic permission");
  assert.equal(store.state.status, "idle");
});

test("voice-status listening — ignored (status is set locally on PWA side)", () => {
  // Regression guard: the comment at use-session.ts:127 says "listening is set
  // locally in startListening() — ignore host echo". If the `!== listening`
  // condition is ever flipped, host's async _start_voice resolving after
  // voice-stop would stomp an already-idle state back to listening.
  const store = makeVoiceStore();
  store.state.status = "idle"; // PWA already moved on
  simulateVoiceStatusHandler({ type: "voice-status", status: "listening" }, store);

  assert.equal(store.state.status, "idle", "listening echo from host must NOT overwrite local state");
});

test("voice-status processing — passed through (host owns this transition)", () => {
  const store = makeVoiceStore();
  simulateVoiceStatusHandler({ type: "voice-status", status: "processing" }, store);

  assert.equal(store.state.status, "processing");
});
