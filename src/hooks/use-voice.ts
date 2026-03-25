"use client";

import { useCallback, useEffect, useRef } from "react";
import { create } from "zustand";
import { VOICE_CHUNK_INTERVAL_MS } from "@/lib/constants";

// ─── Voice State ────────────────────────────────────────────────────────────

export type VoiceStatus = "idle" | "listening" | "processing" | "speaking";
export type VoiceMode = "dictation" | "command";

interface VoiceState {
  status: VoiceStatus;
  mode: VoiceMode | null;
  interimText: string;
  finalText: string;
  /** Accumulated transcript segments for dictation modal */
  transcript: string;

  // Actions (called from hook, not directly)
  setStatus: (s: VoiceStatus) => void;
  setMode: (m: VoiceMode | null) => void;
  setInterimText: (t: string) => void;
  setFinalText: (t: string) => void;
  appendTranscript: (t: string) => void;
  clearTranscript: () => void;
  reset: () => void;
}

export const useVoiceStore = create<VoiceState>((set) => ({
  status: "idle",
  mode: null,
  interimText: "",
  finalText: "",
  transcript: "",

  setStatus: (s) => set({ status: s }),
  setMode: (m) => set({ mode: m }),
  setInterimText: (t) => set({ interimText: t }),
  setFinalText: (t) => set({ finalText: t }),
  appendTranscript: (t) =>
    set((state) => ({
      transcript: state.transcript ? state.transcript + " " + t : t,
    })),
  clearTranscript: () => set({ transcript: "", interimText: "", finalText: "" }),
  reset: () =>
    set({
      status: "idle",
      mode: null,
      interimText: "",
      finalText: "",
      transcript: "",
    }),
}));

// ─── Inline AudioWorklet processor (avoids Next.js compilation issues) ──────

const WORKLET_CODE = `
class PCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = [];
    this._bufferSize = 0;
    // ~100ms of 16kHz audio = 1600 samples
    this._targetSize = 1600;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const samples = input[0];
    this._buffer.push(new Float32Array(samples));
    this._bufferSize += samples.length;

    if (this._bufferSize >= this._targetSize) {
      // Merge all buffered chunks
      const merged = new Float32Array(this._bufferSize);
      let offset = 0;
      for (const chunk of this._buffer) {
        merged.set(chunk, offset);
        offset += chunk.length;
      }
      this._buffer = [];
      this._bufferSize = 0;

      // Float32 → Int16
      const int16 = new Int16Array(merged.length);
      for (let i = 0; i < merged.length; i++) {
        const s = Math.max(-1, Math.min(1, merged[i]));
        int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }

      this.port.postMessage(int16.buffer, [int16.buffer]);
    }
    return true;
  }
}

registerProcessor("pcm-processor", PCMProcessor);
`;

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
  const audioCtxRef = useRef<AudioContext | null>(null);
  const gainRef = useRef<GainNode | null>(null);

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
          dataChannel.send(JSON.stringify({ type: "voice-stop" }));
          return;
        }

        // Create AudioContext BEFORE await — preserves user-gesture token on mobile
        const audioCtx = new AudioContext({ sampleRate: 16000 });
        audioCtxRef.current = audioCtx;

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

        // Guard: stopListening() may have run during the getUserMedia await
        if (!audioCtxRef.current) {
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
        if (!audioCtxRef.current) return;

        const source = audioCtx.createMediaStreamSource(stream);
        sourceRef.current = source;

        const worklet = new AudioWorkletNode(audioCtx, "pcm-processor");
        workletRef.current = worklet;

        // Send PCM chunks to host as binary
        worklet.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
          if (dataChannel.readyState === "open") {
            dataChannel.send(e.data);
          }
        };

        // Connect: source → worklet → silent gain → destination
        // The gain(0) prevents echo but keeps the audio graph alive
        // (Safari GC's disconnected worklet nodes)
        const gain = audioCtx.createGain();
        gain.gain.value = 0;
        gainRef.current = gain;

        source.connect(worklet);
        worklet.connect(gain);
        gain.connect(audioCtx.destination);
      } catch (err) {
        console.error("Mic capture failed:", err);
        store.setStatus("idle");
        store.setMode(null);
        dataChannel.send(JSON.stringify({ type: "voice-stop" }));
      }
    },
    [dataChannel],
  );

  const stopListening = useCallback(() => {
    // Tear down audio pipeline
    if (gainRef.current) {
      gainRef.current.disconnect();
      gainRef.current = null;
    }
    if (workletRef.current) {
      workletRef.current.disconnect();
      workletRef.current = null;
    }
    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close();
      audioCtxRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }

    // Tell host we're done
    if (dataChannel?.readyState === "open") {
      dataChannel.send(JSON.stringify({ type: "voice-stop" }));
    }

    const store = useVoiceStore.getState();
    // Only go to processing if we had content, otherwise just idle
    if (store.transcript || store.finalText) {
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
      gainRef.current?.disconnect();
      workletRef.current?.disconnect();
      sourceRef.current?.disconnect();
      audioCtxRef.current?.close();
    };
  }, []);

  return {
    startListening,
    stopListening,
    acceptDictation,
    cancelDictation,
  };
}
