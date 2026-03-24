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
