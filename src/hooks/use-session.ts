"use client";

import { create } from "zustand";
import type { PcStatus, TransportStatus, PhoneCommand } from "@/types";
import { initiateCall } from "@/lib/webrtc/peer";
import { useVoiceStore, playTTSAudio } from "@/hooks/use-voice";
import { CLIPBOARD_TIMEOUT_MS } from "@/lib/constants";

interface SessionState {
  /** Host status from Supabase */
  pcStatus: PcStatus;
  /** WebRTC transport state */
  transportStatus: TransportStatus;
  /** MediaStream from host video track — attach to <video>.srcObject */
  mediaStream: MediaStream | null;
  /** WebRTC data channel for commands */
  dataChannel: RTCDataChannel | null;
  /** WebRTC peer connection (for ICE restart on app resume) */
  pc: RTCPeerConnection | null;
  /** Host screen dimensions (native, before downscale) */
  screenWidth: number;
  screenHeight: number;
  /** Live PC cursor position, normalized 0–1, broadcast by host at ~20 Hz */
  remoteCursorPos: { x: number; y: number } | null;
  /** Pocket mode (OLED blackout) */
  isPocketMode: boolean;
  /** Session ID from Supabase */
  sessionId: string | null;

  // Actions
  connectToHost: (sessionId: string, iceServers?: RTCIceServer[]) => Promise<void>;
  disconnect: () => void;
  setPcStatus: (status: PcStatus) => void;
  togglePocketMode: () => void;
  setIsPocketMode: (val: boolean) => void;
  sendCommand: (cmd: PhoneCommand) => void;
}

let _close: (() => void) | null = null;
let _disconnectTimer: ReturnType<typeof setTimeout> | null = null;

// ─── Clipboard pre-fetch (same module-level pattern as _close) ──────────────

let _clipboardResolve: ((text: string) => void) | null = null;

/**
 * Returns a Promise that resolves with the PC clipboard text when the host
 * responds to a "get-clipboard" request. Resolves with "" after CLIPBOARD_TIMEOUT_MS
 * to prevent UI soft-lock if the host is unreachable.
 */
export function awaitClipboard(): Promise<string> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      _clipboardResolve = null;
      resolve("");
    }, CLIPBOARD_TIMEOUT_MS);

    _clipboardResolve = (text: string) => {
      clearTimeout(timer);
      resolve(text);
    };
  });
}

export const useSessionStore = create<SessionState>((set, get) => ({
  pcStatus: "offline",
  transportStatus: "idle",
  mediaStream: null,
  dataChannel: null,
  pc: null,
  screenWidth: 0,
  screenHeight: 0,
  remoteCursorPos: null,
  isPocketMode: false,
  sessionId: null,

  connectToHost: async (sessionId, iceServers) => {
    // Clean up any existing connection
    _close?.();
    set({ sessionId, transportStatus: "signaling", mediaStream: null, dataChannel: null });

    const { pc, close } = initiateCall(
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
            } else if (msg.type === "cursor-pos") {
              set({ remoteCursorPos: { x: msg.x, y: msg.y } });
            } else if (msg.type === "stt") {
              const voiceStore = useVoiceStore.getState();
              if (msg.is_final) {
                voiceStore.appendTranscript(msg.text);
                voiceStore.setInterimText("");
              } else {
                voiceStore.setInterimText(msg.text);
              }
            } else if (msg.type === "clipboard") {
              _clipboardResolve?.(msg.text);
              _clipboardResolve = null;
            } else if (msg.type === "clipboard-push") {
              // Host clipboard changed — stash on phone clipboard silently.
              // writeText() needs a user gesture on Safari so .catch() is required.
              navigator.clipboard?.writeText(msg.text).catch(() => {});
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
        else if (state === "connected") {
          // Clear any pending disconnect timer — connection recovered
          if (_disconnectTimer) {
            clearTimeout(_disconnectTimer);
            _disconnectTimer = null;
          }
          set({ transportStatus: "connected" });
        }
        else if (state === "failed") set({ transportStatus: "failed" });
        else if (state === "disconnected") {
          // Transient — WebRTC may self-heal. Don't tear down yet.
          set({ transportStatus: "reconnecting" });
          // If it doesn't recover within 15s, treat as failed
          if (_disconnectTimer) clearTimeout(_disconnectTimer);
          _disconnectTimer = setTimeout(() => {
            _disconnectTimer = null;
            if (get().transportStatus === "reconnecting") {
              set({ transportStatus: "idle", mediaStream: null, dataChannel: null });
            }
          }, 15_000);
        }
        else if (state === "closed") {
          if (_disconnectTimer) {
            clearTimeout(_disconnectTimer);
            _disconnectTimer = null;
          }
          set({ transportStatus: "idle", mediaStream: null, dataChannel: null });
        }
      },
      iceServers,
      // onRejected — host rejected connection (subscription expired)
      () => {
        _close = null;
        set({ transportStatus: "rejected", mediaStream: null, dataChannel: null });
      },
    );

    // Store the pc for ICE restart on app resume
    set({ pc });

    // Listen for app visibility changes — restart ICE if connection dropped
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        const currentState = get();
        if (
          currentState.pc &&
          (currentState.pc.connectionState === "disconnected" ||
            currentState.pc.connectionState === "failed")
        ) {
          currentState.pc.restartIce();
        }
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    _close = () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      close();
    };
  },

  disconnect: () => {
    // Tell the host we're leaving so it can tear down its PC and republish
    // host-ready immediately. Without this, the host waits ~30s for aioice's
    // ICE consent-freshness check to expire, during which the dashboard shows
    // "Desktop host is offline" and blocks instant reconnects.
    const { dataChannel } = get();
    if (dataChannel?.readyState === "open") {
      try {
        dataChannel.send(JSON.stringify({ type: "bye" }));
      } catch {
        // Channel may have just closed — host will fall back to consent expiry
      }
    }

    _close?.();
    _close = null;
    if (_disconnectTimer) {
      clearTimeout(_disconnectTimer);
      _disconnectTimer = null;
    }
    set({
      transportStatus: "idle",
      mediaStream: null,
      dataChannel: null,
      pc: null,
      sessionId: null,
      remoteCursorPos: null,
    });
  },

  setPcStatus: (status) => set({ pcStatus: status }),

  togglePocketMode: () =>
    set((state) => ({ isPocketMode: !state.isPocketMode })),

  setIsPocketMode: (val) => set({ isPocketMode: val }),

  sendCommand: (cmd) => {
    const { dataChannel, isPocketMode } = get();
    if (isPocketMode) return;
    if (dataChannel?.readyState === "open") {
      dataChannel.send(JSON.stringify(cmd));
    }
  },
}));
