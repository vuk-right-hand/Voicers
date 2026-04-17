"use client";

import { useCallback, useEffect, useRef } from "react";
import { create } from "zustand";
import { VOICE_CHUNK_INTERVAL_MS } from "@/lib/constants";
import { WORKLET_CODE, friendlyMessageFor } from "@/hooks/voice-worklet";

// Re-exports so the existing use-session.ts import
// (`import { friendlyMessageFor } from "@/hooks/use-voice"`) keeps working.
export { WORKLET_CODE, friendlyMessageFor };

// ─── Voice State ────────────────────────────────────────────────────────────

export type VoiceStatus = "idle" | "listening" | "processing" | "speaking" | "error";
export type VoiceMode = "dictation" | "command";

interface VoiceState {
  status: VoiceStatus;
  mode: VoiceMode | null;
  interimText: string;
  finalText: string;
  /** Accumulated transcript segments for dictation modal */
  transcript: string;
  /** Brief error message shown as toast when mic capture fails */
  micError: string | null;

  // Actions (called from hook, not directly)
  setStatus: (s: VoiceStatus) => void;
  setMode: (m: VoiceMode | null) => void;
  setInterimText: (t: string) => void;
  setFinalText: (t: string) => void;
  appendTranscript: (t: string) => void;
  clearTranscript: () => void;
  setMicError: (msg: string | null) => void;
  reset: () => void;
}

export const useVoiceStore = create<VoiceState>((set) => ({
  status: "idle",
  mode: null,
  interimText: "",
  finalText: "",
  transcript: "",
  micError: null,

  setStatus: (s) => set({ status: s }),
  setMode: (m) => set({ mode: m }),
  setInterimText: (t) => set({ interimText: t }),
  setFinalText: (t) => set({ finalText: t }),
  appendTranscript: (t) =>
    set((state) => ({
      transcript: state.transcript ? state.transcript + " " + t : t,
    })),
  clearTranscript: () => set({ transcript: "", interimText: "", finalText: "" }),
  setMicError: (msg) => set({ micError: msg }),
  reset: () =>
    set({
      status: "idle",
      mode: null,
      interimText: "",
      finalText: "",
      transcript: "",
      micError: null,
    }),
}));

// ─── Audio Context singleton (unlocked on first interaction) ────────────────

let _audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!_audioCtx) {
    _audioCtx = new AudioContext();
  }
  return _audioCtx;
}

/**
 * MUST be called from a user gesture handler (tap/click) to unlock audio
 * on iOS Safari and Android Chrome.
 */
export function unlockAudioContext(): void {
  const ctx = getAudioContext();
  if (ctx.state === "suspended") {
    ctx.resume();
  }
}

// ─── STT Pre-warm (module-level, indicator-free) ───────────────────────────
//
// Pre-warmed at connect time from a user-gesture (preserves iOS gesture chain
// for audioWorklet.addModule). Does NOT call getUserMedia — the mic indicator
// only lights when startListening() runs, preserving the "mic lights = I'm
// being listened to" UX contract.

let _sttAudioCtx: AudioContext | null = null;
let _sttGain: GainNode | null = null;
let _sttAudioReady = false;
let _sttInputSampleRate = 16000;

export function isSttAudioReady(): boolean {
  return _sttAudioReady;
}

export function getSttAudioCtx(): AudioContext | null {
  return _sttAudioCtx;
}

export function getSttGain(): GainNode | null {
  return _sttGain;
}

export function getSttInputSampleRate(): number {
  return _sttInputSampleRate;
}

/**
 * Warm `new AudioContext({sampleRate: 16000})` + `audioWorklet.addModule` at
 * connect time so startListening() only pays the cost of getUserMedia.
 * MUST be called from inside a user-gesture handler (iOS Safari requires a
 * gesture-scoped Promise chain for audioWorklet.addModule).
 *
 * Idempotent: no-op if already warm. Silent failure falls back to cold-start
 * inside startListening().
 */
export async function prewarmAudio(): Promise<void> {
  if (_sttAudioReady) return;
  if (typeof AudioContext === "undefined") return;
  if (process.env.NEXT_PUBLIC_AUDIO_PREWARM === "false") return;
  try {
    const audioCtx = new AudioContext({ sampleRate: 16000 });
    _sttAudioCtx = audioCtx;
    _sttInputSampleRate = audioCtx.sampleRate;

    const blob = new Blob([WORKLET_CODE], { type: "application/javascript" });
    const workletUrl = URL.createObjectURL(blob);
    try {
      await audioCtx.audioWorklet.addModule(workletUrl);
    } finally {
      URL.revokeObjectURL(workletUrl);
    }

    const gain = audioCtx.createGain();
    gain.gain.value = 0;
    gain.connect(audioCtx.destination);
    _sttGain = gain;

    _sttAudioReady = true;
    console.info(
      "[voice] audio pre-warm complete — rate=%d",
      audioCtx.sampleRate,
    );
  } catch (err) {
    console.warn("[voice] audio pre-warm failed — will cold-start:", err);
    _sttAudioCtx = null;
    _sttGain = null;
    _sttAudioReady = false;
  }
}

/**
 * Full teardown on leaving the connected session. Called from use-session's
 * disconnect path. startListening's cold path will re-bootstrap on next use.
 */
export async function teardownAudioPrewarm(): Promise<void> {
  if (_sttAudioCtx) {
    try { _sttGain?.disconnect(); } catch { /* ignore */ }
    try { await _sttAudioCtx.close(); } catch { /* ignore */ }
  }
  _sttAudioCtx = null;
  _sttGain = null;
  _sttAudioReady = false;
  _sttInputSampleRate = 16000;
  console.info("[voice] audio teardown complete");
}

// ─── TTS Playback ───────────────────────────────────────────────────────────

let _currentAudio: HTMLAudioElement | null = null;

/**
 * Play raw MP3 bytes received as ArrayBuffer from the data channel.
 * Uses a Blob URL → <audio> element for simplicity and iOS compat.
 */
export function playTTSAudio(mp3Buffer: ArrayBuffer): void {
  // Ensure AudioContext is alive (for iOS)
  unlockAudioContext();

  // Clean up previous playback
  if (_currentAudio) {
    _currentAudio.pause();
    if (_currentAudio.src) URL.revokeObjectURL(_currentAudio.src);
    _currentAudio = null;
  }

  const blob = new Blob([mp3Buffer], { type: "audio/mpeg" });
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);

  audio.onended = () => {
    URL.revokeObjectURL(url);
    _currentAudio = null;
    useVoiceStore.getState().setStatus("idle");
  };

  audio.onerror = () => {
    URL.revokeObjectURL(url);
    _currentAudio = null;
    useVoiceStore.getState().setStatus("idle");
  };

  _currentAudio = audio;
  useVoiceStore.getState().setStatus("speaking");
  audio.play().catch(() => {
    useVoiceStore.getState().setStatus("idle");
  });
}

// ─── Main Hook ──────────────────────────────────────────────────────────────

interface UseVoiceOptions {
  dataChannel: RTCDataChannel | null;
}

export function useVoice({ dataChannel }: UseVoiceOptions) {
  const streamRef = useRef<MediaStream | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  // Cold-path only — holds the AudioContext created inside startListening().
  // Warm path uses the module-level _sttAudioCtx via getSttAudioCtx().
  const coldAudioCtxRef = useRef<AudioContext | null>(null);
  // Cold-path only. Warm path references the module-level _sttGain.
  const coldGainRef = useRef<GainNode | null>(null);
  const mutedRef = useRef(false);
  const inputSampleRateRef = useRef<number>(16000);
  // Live reference so the worklet onmessage closure always reads the
  // current DC — without this, a reconnect (new DC, same PWA tab) would
  // leave tap #2 shipping audio over a dead channel.
  const dataChannelRef = useRef<RTCDataChannel | null>(dataChannel);
  dataChannelRef.current = dataChannel;

  // iOS 17.4+ may GC the worklet while muted even with the gain(0) workaround.
  // On unmute we tear down source/worklet but keep audioCtx + gain + stream,
  // then rebuild the graph. Safe to call any time status=="listening".
  const rebuildWorkletGraph = useCallback(() => {
    // Prefer the warm AudioContext if pre-warm succeeded this session.
    const audioCtx = getSttAudioCtx() ?? coldAudioCtxRef.current;
    const gain = getSttGain() ?? coldGainRef.current;
    const stream = streamRef.current;
    if (!audioCtx || !stream || !gain) return;
    if (useVoiceStore.getState().status !== "listening") return;

    try { workletRef.current?.disconnect(); } catch { /* ignore */ }
    try { sourceRef.current?.disconnect(); } catch { /* ignore */ }

    const source = audioCtx.createMediaStreamSource(stream);
    sourceRef.current = source;

    const worklet = new AudioWorkletNode(audioCtx, "pcm-processor", {
      processorOptions: { inputSampleRate: inputSampleRateRef.current },
    });
    workletRef.current = worklet;
    worklet.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
      if (mutedRef.current) return;
      const dc = dataChannelRef.current;
      if (dc && dc.readyState === "open") {
        dc.send(e.data);
      }
    };
    source.connect(worklet);
    worklet.connect(gain);
  }, []);

  const startListening = useCallback(
    async (mode: VoiceMode) => {
      if (!dataChannel || dataChannel.readyState !== "open") return;

      const store = useVoiceStore.getState();
      if (store.status === "listening") return;

      // Unlock audio for TTS playback on this user gesture
      unlockAudioContext();

      store.setStatus("listening");
      store.setMode(mode);
      store.clearTranscript();
      store.setMicError(null);
      mutedRef.current = false;

      // Tell host we're starting
      dataChannel.send(JSON.stringify({ type: "voice-start", mode }));

      try {
        // getUserMedia requires HTTPS (secure context). On plain HTTP it's undefined.
        if (!navigator.mediaDevices?.getUserMedia) {
          console.error(
            "Mic unavailable — getUserMedia requires HTTPS. " +
            "Access via https:// or use `next dev --experimental-https`."
          );
          store.setStatus("idle");
          store.setMode(null);
          dataChannel.send(JSON.stringify({ type: "voice-stop", reason: "no-https" }));
          return;
        }

        // ── Warm path ────────────────────────────────────────────────────
        // prewarmAudio() already created AudioContext + loaded the worklet
        // module + built the silent gain node. We just need getUserMedia
        // (the one API that lights the OS mic indicator) + graph wiring.
        const warmCtx = getSttAudioCtx();
        const warmGain = getSttGain();
        if (isSttAudioReady() && warmCtx && warmGain) {
          const audioCtx = warmCtx;
          const gain = warmGain;

          // Mobile browsers suspend the AudioContext when the PWA backgrounds.
          // Without resume() the warm fast-path silently emits zero PCM.
          if (audioCtx.state === "suspended") {
            await audioCtx.resume();
          }

          const inputSampleRate = audioCtx.sampleRate;
          inputSampleRateRef.current = inputSampleRate;

          const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              sampleRate: 16000,
              channelCount: 1,
              echoCancellation: true,
              noiseSuppression: true,
            },
          });
          streamRef.current = stream;

          try {
            dataChannel.send(JSON.stringify({
              type: "mic-info",
              sampleRate: inputSampleRate,
              channelCount: 1,
              userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "unknown",
            }));
          } catch { /* channel closed between check and send */ }

          const audioTrack = stream.getAudioTracks()[0];
          if (audioTrack) {
            audioTrack.onended = () => {
              console.warn("[voice] Audio track ended — mic was revoked or taken by another app");
              if (dataChannel.readyState === "open") {
                try { dataChannel.send(JSON.stringify({ type: "voice-stop", reason: "track-ended" })); }
                catch { /* ignore */ }
              }
              stopListening("track-ended");
              useVoiceStore.getState().setMicError("Mic disconnected");
            };
            audioTrack.onmute = () => {
              console.warn("[voice] Audio track muted by OS/browser");
              mutedRef.current = true;
              useVoiceStore.getState().setMicError("Mic paused by OS");
            };
            audioTrack.onunmute = () => {
              console.info("[voice] Audio track unmuted");
              mutedRef.current = false;
              useVoiceStore.getState().setMicError(null);
              rebuildWorkletGraph();
            };
          }

          // Guard: stopListening() may have run during the getUserMedia await
          if (!isSttAudioReady()) {
            stream.getTracks().forEach((t) => t.stop());
            streamRef.current = null;
            return;
          }

          const source = audioCtx.createMediaStreamSource(stream);
          sourceRef.current = source;

          const worklet = new AudioWorkletNode(audioCtx, "pcm-processor", {
            processorOptions: { inputSampleRate },
          });
          workletRef.current = worklet;

          // Rebind every call: the closure captures dataChannelRef.current, so
          // a reconnect (same PWA tab, new DC) doesn't leave tap #N shipping
          // audio over a dead channel.
          worklet.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
            if (mutedRef.current) return;
            const dc = dataChannelRef.current;
            if (dc && dc.readyState === "open") {
              dc.send(e.data);
            }
          };

          source.connect(worklet);
          worklet.connect(gain);
          return;
        }

        // ── Cold path ────────────────────────────────────────────────────
        // Pre-warm was skipped (flag off) or failed. Full legacy setup.

        // Create AudioContext BEFORE await — preserves user-gesture token on mobile
        const audioCtx = new AudioContext({ sampleRate: 16000 });
        coldAudioCtxRef.current = audioCtx;

        // Android Chrome / Pixel often ignores the 16 kHz request and runs the
        // context at the device native rate (48 kHz). Read the actual rate and
        // route through the worklet's decimation path if needed.
        const inputSampleRate = audioCtx.sampleRate;
        inputSampleRateRef.current = inputSampleRate;
        const needsDecimate = inputSampleRate !== 16000;
        console.info(
          "[voice] AudioContext rate=%d, decimating: %s",
          inputSampleRate,
          needsDecimate,
        );

        // Get mic stream (async — would lose gesture token if AudioContext created after)
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            sampleRate: 16000,
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
          },
        });
        streamRef.current = stream;

        // Tell host what rate we're actually running at — correlates client
        // reality with server logs when debugging "no audio" reports.
        try {
          dataChannel.send(JSON.stringify({
            type: "mic-info",
            sampleRate: inputSampleRate,
            channelCount: 1,
            userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "unknown",
          }));
        } catch {
          // Channel may have closed between status check and send — host can
          // still operate, just without the diagnostic.
        }

        // Monitor audio track lifecycle — detect mic death from OS/browser
        const audioTrack = stream.getAudioTracks()[0];
        if (audioTrack) {
          audioTrack.onended = () => {
            console.warn("[voice] Audio track ended — mic was revoked or taken by another app");
            if (dataChannel.readyState === "open") {
              try { dataChannel.send(JSON.stringify({ type: "voice-stop", reason: "track-ended" })); }
              catch { /* ignore */ }
            }
            stopListening("track-ended");
            useVoiceStore.getState().setMicError("Mic disconnected");
          };
          audioTrack.onmute = () => {
            console.warn("[voice] Audio track muted by OS/browser");
            mutedRef.current = true;
            useVoiceStore.getState().setMicError("Mic paused by OS");
          };
          audioTrack.onunmute = () => {
            console.info("[voice] Audio track unmuted");
            mutedRef.current = false;
            useVoiceStore.getState().setMicError(null);
            rebuildWorkletGraph();
          };
        }

        // Guard: stopListening() may have run during the getUserMedia await
        if (!coldAudioCtxRef.current) {
          stream.getTracks().forEach((t) => t.stop());
          streamRef.current = null;
          return;
        }

        // Resume if suspended (belt-and-suspenders for iOS)
        if (audioCtx.state === "suspended") {
          await audioCtx.resume();
        }

        // Create inline worklet from Blob URL
        const blob = new Blob([WORKLET_CODE], { type: "application/javascript" });
        const workletUrl = URL.createObjectURL(blob);

        try {
          await audioCtx.audioWorklet.addModule(workletUrl);
        } finally {
          URL.revokeObjectURL(workletUrl);
        }

        // Guard: stopListening() may have run during the addModule await
        if (!coldAudioCtxRef.current) return;

        const source = audioCtx.createMediaStreamSource(stream);
        sourceRef.current = source;

        const worklet = new AudioWorkletNode(audioCtx, "pcm-processor", {
          processorOptions: { inputSampleRate },
        });
        workletRef.current = worklet;

        // Send PCM chunks to host as binary. Read DC through the ref so this
        // closure survives a reconnect cycle.
        worklet.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
          if (mutedRef.current) return;  // OS paused the mic — don't ship zeros
          const dc = dataChannelRef.current;
          if (dc && dc.readyState === "open") {
            dc.send(e.data);
          }
        };

        // Connect: source → worklet → silent gain → destination
        // The gain(0) prevents echo but keeps the audio graph alive
        // (Safari GC's disconnected worklet nodes)
        const gain = audioCtx.createGain();
        gain.gain.value = 0;
        coldGainRef.current = gain;

        source.connect(worklet);
        worklet.connect(gain);
        gain.connect(audioCtx.destination);
      } catch (err) {
        console.error("Mic capture failed:", err);
        store.setStatus("idle");
        store.setMode(null);
        dataChannel.send(JSON.stringify({ type: "voice-stop", reason: "mic-error" }));

        // Surface a user-visible toast
        const name = (err as DOMException)?.name;
        if (name === "NotAllowedError" || name === "NotReadableError") {
          store.setMicError("Mic busy — screen recording?");
        } else {
          store.setMicError("Mic unavailable");
        }
      }
    },
    [dataChannel],
  );

  const stopListening = useCallback((reason?: string) => {
    const why = reason || "unknown";
    console.trace(`[voice] stopListening called — reason: ${why}`);

    // Per-turn teardown: release mic + disconnect source/worklet so the OS
    // mic indicator goes OFF. Keep the warm AudioContext + silent gain so
    // the next voice-tap takes the fast path.
    if (workletRef.current) {
      try { workletRef.current.disconnect(); } catch { /* ignore */ }
      workletRef.current = null;
    }
    if (sourceRef.current) {
      try { sourceRef.current.disconnect(); } catch { /* ignore */ }
      sourceRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }

    // Cold-path teardown: if startListening bootstrapped its own context
    // (pre-warm disabled / failed), close it here. Warm context lives at
    // module level and is torn down in teardownAudioPrewarm() on disconnect.
    if (coldGainRef.current) {
      try { coldGainRef.current.disconnect(); } catch { /* ignore */ }
      coldGainRef.current = null;
    }
    if (coldAudioCtxRef.current) {
      try { coldAudioCtxRef.current.close(); } catch { /* ignore */ }
      coldAudioCtxRef.current = null;
    }

    // Tell host we're done
    if (dataChannel?.readyState === "open") {
      dataChannel.send(JSON.stringify({ type: "voice-stop", reason: why }));
    }

    const store = useVoiceStore.getState();
    if (store.mode === "dictation") {
      // Status goes idle immediately (mic is off, no spinner).
      // mode stays "dictation" if there's text — prevents modal auto-close.
      // is_final from host will arrive shortly and update the transcript.
      store.setStatus("idle");
      if (!store.transcript && !store.interimText) {
        store.setMode(null); // Nothing captured → let modal close
      }
    } else if (store.transcript || store.finalText) {
      store.setStatus("processing");
    } else {
      store.setStatus("idle");
      store.setMode(null);
    }
  }, [dataChannel]);

  /**
   * Send the accepted dictation text to host for pasting.
   */
  const acceptDictation = useCallback(
    (text: string) => {
      if (!dataChannel || dataChannel.readyState !== "open") return;
      dataChannel.send(JSON.stringify({ type: "type-text", text }));
      useVoiceStore.getState().reset();
    },
    [dataChannel],
  );

  const cancelDictation = useCallback(() => {
    useVoiceStore.getState().reset();
  }, []);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
      try { workletRef.current?.disconnect(); } catch { /* ignore */ }
      try { sourceRef.current?.disconnect(); } catch { /* ignore */ }
      try { coldGainRef.current?.disconnect(); } catch { /* ignore */ }
      try { coldAudioCtxRef.current?.close(); } catch { /* ignore */ }
    };
  }, []);

  return {
    startListening,
    stopListening,
    acceptDictation,
    cancelDictation,
  };
}
