export type PlanId = "free" | "byok" | "pro";

export type PcStatus = "offline" | "waiting" | "connected";

export interface Profile {
  id: string;
  email: string;
  display_name: string | null;
  plan: PlanId;
  stripe_customer_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Session {
  id: string;
  user_id: string;
  pc_status: PcStatus;
  signaling_data: Record<string, unknown> | null;
  last_ping: string;
  created_at: string;
}

// --- WebRTC Signaling ---

export type SignalingData =
  | { type: "host-ready"; host_id: string }
  | { type: "offer"; sdp: string; from: "phone" }
  | { type: "answer"; sdp: string; from: "host" }
  | { type: "ice-candidate"; candidate: string; from: "host" | "phone" }
  | { type: "rejected"; reason: string };

// Phone → Host (via data channel)
export type PhoneCommand =
  | { type: "tap"; x: number; y: number }
  | { type: "scroll"; delta: number }
  | { type: "type"; text: string }
  | { type: "command"; action: string; payload: Record<string, unknown> }
  | { type: "voice-start"; mode: "dictation" | "command" }
  | { type: "voice-stop" }
  | { type: "type-text"; text: string }
  | { type: "mousemove"; dx: number; dy: number }
  | { type: "mousedown" }
  | { type: "mouseup" }
  | { type: "click" }
  | { type: "double-click" }
  | { type: "moveto"; x: number; y: number }
  | { type: "get-clipboard" };
// Note: binary ArrayBuffer (raw PCM audio) is also sent but not typed here

// Host → Phone (via data channel)
export type HostMessage =
  | { type: "screen-info"; width: number; height: number }
  | { type: "error"; message: string }
  | { type: "stt"; text: string; is_final: boolean }
  | { type: "voice-status"; status: "listening" | "processing" | "speaking" | "idle" }
  | { type: "clipboard"; text: string }
  | { type: "clipboard-push"; text: string };
// Note: binary ArrayBuffer (raw MP3 TTS) is also sent but not typed here

export type TransportStatus = "idle" | "signaling" | "connecting" | "connected" | "reconnecting" | "failed" | "rejected";

export interface Subscription {
  id: string;
  user_id: string;
  stripe_subscription_id: string;
  stripe_price_id: string;
  status: string;
  current_period_start: string | null;
  current_period_end: string | null;
  created_at: string;
  updated_at: string;
}
