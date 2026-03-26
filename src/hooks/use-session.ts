"use client";

import { create } from "zustand";
import type { PcStatus, TransportStatus, PhoneCommand } from "@/types";
import { initiateCall } from "@/lib/webrtc/peer";
import { useVoiceStore, playTTSAudio } from "@/hooks/use-voice";

interface SessionState {
  /** Host status from Supabase */
  pcStatus: PcStatus;
  /** WebRTC transport state */
  transportStatus: TransportStatus;
  /** MediaStream from host video track — attach to <video>.srcObject */
  mediaStream: MediaStream | null;
  /** WebRTC data channel for commands */
  dataChannel: RTCDataChannel | null;
  /** Host screen dimensions (native, before downscale) */
  screenWidth: number;
  screenHeight: number;
  /** Pocket mode (OLED blackout) */
  isPocketMode: boolean;
  /** Session ID from Supabase */
  sessionId: string | null;

  // Actions
  connectToHost: (sessionId: string) => void;
  disconnect: () => void;
  setPcStatus: (status: PcStatus) => void;
  togglePocketMode: () => void;
  sendCommand: (cmd: PhoneCommand) => void;
}

let _close: (() => void) | null = null;

export const useSessionStore = create<SessionState>((set, get) => ({
  pcStatus: "offline",
  transportStatus: "idle",
  mediaStream: null,
  dataChannel: null,
  screenWidth: 0,
  screenHeight: 0,
  isPocketMode: false,
  sessionId: null,

  connectToHost: (sessionId) => {
    // Clean up any existing connection
    _close?.();
    set({ sessionId, transportStatus: "signaling", mediaStream: null, dataChannel: null });

    const { close } = initiateCall(
      sessionId,
      // onStream
      (stream) => set({ mediaStream: stream }),
      // onDataChannel
      (dc) => {
        set({ dataChannel: dc });

        dc.binaryType = "arraybuffer";
        dc.onmessage = (event) => {
          // Binary message = TTS audio (raw MP3 bytes from host)
          if (event.data instanceof ArrayBuffer) {
            playTTSAudio(event.data);
            return;
          }

          try {
            const msg = JSON.parse(event.data);

            if (msg.type === "screen-info") {
              set({ screenWidth: msg.width, screenHeight: msg.height });
            } else if (msg.type === "stt") {
              const voiceStore = useVoiceStore.getState();
              if (msg.is_final) {
                voiceStore.appendTranscript(msg.text);
                voiceStore.setInterimText("");
              } else {
                voiceStore.setInterimText(msg.text);
              }
            } else if (msg.type === "voice-status") {
              // "listening" is set locally in startListening() — ignore host echo
              // to avoid race where _start_voice resolves after voice-stop already ran.
              if (msg.status !== "listening") {
                useVoiceStore.getState().setStatus(msg.status);
              }
            }
          } catch {
            // ignore malformed messages
          }
        };

        dc.onclose = () => set({ dataChannel: null });
      },
      // onStateChange
      (state) => {
        if (state === "connecting") set({ transportStatus: "connecting" });
        else if (state === "connected") set({ transportStatus: "connected" });
        else if (state === "failed") set({ transportStatus: "failed" });
        else if (state === "disconnected" || state === "closed") {
          set({
            transportStatus: "idle",
            mediaStream: null,
            dataChannel: null,
          });
        }
      },
    );

    _close = close;
  },

  disconnect: () => {
    _close?.();
    _close = null;
    set({
      transportStatus: "idle",
      mediaStream: null,
      dataChannel: null,
      sessionId: null,
    });
  },

  setPcStatus: (status) => set({ pcStatus: status }),

  togglePocketMode: () =>
    set((state) => ({ isPocketMode: !state.isPocketMode })),

  sendCommand: (cmd) => {
    const { dataChannel, isPocketMode } = get();
    if (isPocketMode) return;
    if (dataChannel?.readyState === "open") {
      dataChannel.send(JSON.stringify(cmd));
    }
  },
}));
