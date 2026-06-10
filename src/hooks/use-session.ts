"use client";

import { create } from "zustand";
import type { PcStatus, TransportStatus, PhoneCommand, SignalingData } from "@/types";
import { initiateCall } from "@/lib/webrtc/peer";
import { fetchActiveSession } from "@/lib/webrtc/signaling";
import {
  useVoiceStore,
  playTTSAudio,
  friendlyMessageFor,
  prewarmAudio,
  teardownAudioPrewarm,
} from "@/hooks/use-voice";
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
  /** WebRTC peer connection (for liveness checks on app resume) */
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
  /** Authenticated user — needed to re-fetch the active session on reconnect
   *  (the host creates a NEW session row when it restarts, so the old
   *  sessionId can go stale at any time). */
  userId: string | null;
  /** Consecutive auto-reconnect attempts since last success/user trigger */
  reconnectAttempt: number;

  // Actions
  connectToHost: (sessionId: string, iceServers?: RTCIceServer[], userId?: string) => Promise<void>;
  /** Full re-dial: re-fetch the active session row, then send a fresh SDP
   *  offer. The ONLY reliable recovery path — aiortc doesn't support ICE
   *  restarts, so a dead connection always needs a brand-new handshake. */
  reconnect: () => Promise<void>;
  disconnect: () => void;
  setPcStatus: (status: PcStatus) => void;
  togglePocketMode: () => void;
  setIsPocketMode: (val: boolean) => void;
  sendCommand: (cmd: PhoneCommand) => void;
}

let _close: (() => void) | null = null;
let _disconnectTimer: ReturnType<typeof setTimeout> | null = null;

// ─── Auto-reconnect machinery (module-level, like _close) ───────────────────

/** Max chained auto-reconnect attempts before giving up with "failed".
 *  Each user-visible trigger (app resume, manual retry) resets the budget. */
const MAX_RECONNECT_ATTEMPTS = 4;

/** True between an explicit user Disconnect and the next connectToHost —
 *  suppresses every auto-reconnect path. */
let _userDisconnected = false;
let _reconnectInFlight = false;
/** Arms after the offer is sent; if no answer arrives within the window the
 *  host may have restarted under a new session row — re-fetch and re-dial. */
let _offerWatchdog: ReturnType<typeof setTimeout> | null = null;
let _lifecycleHandlersInstalled = false;

function clearOfferWatchdog() {
  if (_offerWatchdog) {
    clearTimeout(_offerWatchdog);
    _offerWatchdog = null;
  }
}

/**
 * App came back to the foreground (or bfcache restore on iOS). If the
 * transport is anything other than verifiably healthy, re-dial. Covers:
 * Android/iOS backgrounding, phone calls, screen lock, PWA swipe-and-reopen
 * while the page survived in memory.
 */
function maybeReconnectOnResume() {
  const s = useSessionStore.getState();
  if (_userDisconnected || !s.userId) return;
  if (s.transportStatus === "rejected") return; // subscription gate — don't loop
  if (s.transportStatus === "signaling" || s.transportStatus === "connecting") return;

  const pcAlive =
    s.pc !== null &&
    !["disconnected", "failed", "closed"].includes(s.pc.connectionState);
  const dcOpen = s.dataChannel?.readyState === "open";
  if (s.transportStatus === "connected" && pcAlive && dcOpen) return; // healthy

  // Fresh user-visible trigger — reset the attempt budget and re-dial.
  useSessionStore.setState({ reconnectAttempt: 0 });
  void s.reconnect();
}

function installLifecycleHandlers() {
  if (_lifecycleHandlersInstalled || typeof document === "undefined") return;
  _lifecycleHandlersInstalled = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") maybeReconnectOnResume();
  });
  // iOS Safari restores PWAs from bfcache without firing visibilitychange.
  window.addEventListener("pageshow", () => maybeReconnectOnResume());
}

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
  userId: null,
  reconnectAttempt: 0,

  connectToHost: async (sessionId, iceServers, userId) => {
    // Clean up any existing connection
    _close?.();
    clearOfferWatchdog();
    _userDisconnected = false;
    installLifecycleHandlers();
    set({
      sessionId,
      transportStatus: "signaling",
      mediaStream: null,
      dataChannel: null,
      ...(userId ? { userId } : {}),
    });

    // Indicator-free audio pre-warm. Runs inside the user-gesture stack so
    // iOS Safari allows audioWorklet.addModule. Fire-and-forget: failures
    // fall back to cold-start inside startListening().
    void prewarmAudio();

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
              const voiceStore = useVoiceStore.getState();
              if (msg.status === "error") {
                voiceStore.setMicError(friendlyMessageFor(msg.reason));
                voiceStore.setStatus("idle");
                voiceStore.setMode(null);
              } else if (msg.status !== "listening") {
                // "listening" is set locally in startListening() — ignore host echo
                // to avoid race where _start_voice resolves after voice-stop already ran.
                voiceStore.setStatus(msg.status);
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
        if (state === "connecting") {
          clearOfferWatchdog();
          set({ transportStatus: "connecting" });
        }
        else if (state === "connected") {
          // Clear any pending disconnect timer — connection recovered
          clearOfferWatchdog();
          if (_disconnectTimer) {
            clearTimeout(_disconnectTimer);
            _disconnectTimer = null;
          }
          set({ transportStatus: "connected", reconnectAttempt: 0 });
        }
        else if (state === "failed") {
          // ICE gave up. aiortc can't ICE-restart — only a fresh offer helps.
          clearOfferWatchdog();
          if (_userDisconnected) {
            set({ transportStatus: "failed" });
          } else {
            void get().reconnect();
          }
        }
        else if (state === "disconnected") {
          // Transient — WebRTC may self-heal. Don't tear down yet.
          set({ transportStatus: "reconnecting" });
          // If it doesn't recover within 15s, re-dial instead of giving up.
          if (_disconnectTimer) clearTimeout(_disconnectTimer);
          _disconnectTimer = setTimeout(() => {
            _disconnectTimer = null;
            if (get().transportStatus === "reconnecting" && !_userDisconnected) {
              void get().reconnect();
            }
          }, 15_000);
        }
        else if (state === "closed") {
          if (_disconnectTimer) {
            clearTimeout(_disconnectTimer);
            _disconnectTimer = null;
          }
          if (_userDisconnected) {
            set({ transportStatus: "idle", mediaStream: null, dataChannel: null });
          } else {
            // Host closed the connection from its side (process restart,
            // teardown after our backgrounding) — re-dial.
            set({ mediaStream: null, dataChannel: null });
            void get().reconnect();
          }
        }
      },
      iceServers,
      // onRejected — host rejected connection (subscription expired)
      () => {
        _close = null;
        set({ transportStatus: "rejected", mediaStream: null, dataChannel: null });
      },
    );

    // Store the pc for liveness checks on app resume
    set({ pc });

    // Offer-answer watchdog: if the host never answers (it restarted with a
    // new session row, its Realtime sub was dead, the row write was lost),
    // re-fetch the session and re-dial. Cleared as soon as ICE starts
    // ("connecting") or the connection lands.
    _offerWatchdog = setTimeout(() => {
      _offerWatchdog = null;
      if (!_userDisconnected && get().transportStatus === "signaling") {
        void get().reconnect();
      }
    }, 12_000);

    _close = () => {
      close();
    };
  },

  reconnect: async () => {
    if (_userDisconnected || _reconnectInFlight) return;
    const { userId } = get();
    if (!userId) return;

    const attempt = get().reconnectAttempt;
    if (attempt >= MAX_RECONNECT_ATTEMPTS) {
      set({ transportStatus: "failed" });
      return;
    }

    _reconnectInFlight = true;
    set({ reconnectAttempt: attempt + 1, transportStatus: "reconnecting" });
    try {
      // Backoff: 0 / 1.5s / 3s / 4.5s between chained attempts.
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, attempt * 1500));
      }
      if (_userDisconnected) return;

      // Always re-fetch — the host creates a NEW session row on every boot
      // (including its own self-restart hygiene), so the stored sessionId
      // can be stale. ICE servers ride along in the host-ready payload.
      let row = null;
      try {
        const { data } = await fetchActiveSession(userId);
        row = data;
      } catch {
        // network hiccup — treated like a missing row below
      }
      if (_userDisconnected) return;

      if (!row) {
        // No session row / fetch failed — chain another attempt (bounded by
        // MAX_RECONNECT_ATTEMPTS) in case the host is mid-restart.
        _reconnectInFlight = false;
        void get().reconnect();
        return;
      }

      const raw = row.signaling_data;
      const sig: SignalingData | null =
        typeof raw === "string" ? JSON.parse(raw) : (raw as unknown as SignalingData | null);
      const ice = sig?.type === "host-ready" ? sig.ice_servers : undefined;
      await get().connectToHost(row.id, ice, userId);
    } finally {
      _reconnectInFlight = false;
    }
  },

  disconnect: () => {
    // Explicit user intent — suppress every auto-reconnect path until the
    // next connectToHost.
    _userDisconnected = true;
    clearOfferWatchdog();

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
    // Tear down the warm STT AudioContext so a later reconnect pre-warms a
    // fresh one. Fire-and-forget — close() is async but we don't wait.
    void teardownAudioPrewarm();
    set({
      transportStatus: "idle",
      mediaStream: null,
      dataChannel: null,
      pc: null,
      sessionId: null,
      remoteCursorPos: null,
      reconnectAttempt: 0,
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
