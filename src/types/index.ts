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
  | { type: "ice-candidate"; candidate: string; from: "host" | "phone" };

// Phone → Host (via data channel)
export type PhoneCommand =
  | { type: "tap"; x: number; y: number }
  | { type: "scroll"; delta: number }
  | { type: "type"; text: string }
  | { type: "command"; action: string; payload: Record<string, unknown> };

// Host → Phone (via data channel)
export type HostMessage =
  | { type: "screen-info"; width: number; height: number }
  | { type: "error"; message: string };

export type TransportStatus = "idle" | "signaling" | "connecting" | "connected" | "failed";

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
