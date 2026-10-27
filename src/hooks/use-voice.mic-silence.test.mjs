// Mic silence detector (2026-10-27) — diagnostic for the Android "STT stops
// after 10-15 s / dead on next tap" report. Pins the classification so the
// host log reliably says whether the phone shipped digital zero, a long
// near-silent stretch, or real audio.
//
// Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MicSilenceTracker,
  peakAbsInt16,
} from "./voice-worklet.ts";

function feed(tracker, peak, chunks) {
  const events = [];
  for (let i = 0; i < chunks; i++) {
    const ev = tracker.push(peak);
    if (ev) events.push(ev);
  }
  return events;
}

test("peakAbsInt16 handles negative extremes", () => {
  const buf = new Int16Array([3, -32768, 12, 0]).buffer;
  assert.equal(peakAbsInt16(buf), 32768);
});

test("2 s of digital zero reports 'silent' exactly once", () => {
  const t = new MicSilenceTracker();
  const evs = feed(t, 0, 80);
  assert.equal(evs.length, 1);
  assert.equal(evs[0].kind, "silent");
  assert.equal(evs[0].seconds, 2);
});

test("a natural pause (noise-suppressed, not zero) is only 'quiet' after 5 s", () => {
  const t = new MicSilenceTracker();
  assert.deepEqual(feed(t, 5, 49), []);
  const evs = feed(t, 5, 30);
  assert.equal(evs.length, 1);
  assert.equal(evs[0].kind, "quiet");
});

test("short pauses between words report nothing", () => {
  const t = new MicSilenceTracker();
  for (let i = 0; i < 20; i++) {
    assert.deepEqual(feed(t, 3, 15), []); // 1.5 s pause
    assert.deepEqual(feed(t, 4000, 10), []); // speech
  }
});

test("speech after a report emits 'recovered' with the gap length", () => {
  const t = new MicSilenceTracker();
  feed(t, 0, 35);
  const evs = feed(t, 2500, 1);
  assert.equal(evs.length, 1);
  assert.equal(evs[0].kind, "recovered");
  assert.equal(evs[0].seconds, 3.5);
  // Re-arms for the next dead stretch.
  assert.equal(feed(t, 0, 20)[0].kind, "silent");
});

test("one 1-LSB blip inside zeros still counts as digital silence", () => {
  const t = new MicSilenceTracker();
  feed(t, 0, 10);
  feed(t, 1, 1);
  const evs = feed(t, 0, 10);
  assert.equal(evs[0].kind, "silent");
});
