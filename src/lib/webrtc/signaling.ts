/**
 * WebRTC Signaling via Supabase Realtime
 *
 * Uses the `sessions` table to exchange SDP offers/answers and ICE candidates
 * between the phone (PWA) and the desktop host.
 */

import { createClient } from "@/lib/supabase/client";
import type { Session, SignalingData } from "@/types";

const TABLE = "sessions";

export function fetchActiveSession(userId: string) {
  const supabase = createClient();
  return supabase
    .from(TABLE)
    .select("*")
    .eq("user_id", userId)
    .single<Session>();
}

export function updateSignalingData(sessionId: string, data: SignalingData) {
  const supabase = createClient();
  return supabase
    .from(TABLE)
    .update({ signaling_data: data as unknown as Record<string, unknown> })
    .eq("id", sessionId);
}

export function subscribeToSession(
  sessionId: string,
  onSignaling: (data: SignalingData) => void,
  onStatusChange?: (status: string) => void,
  channelSuffix?: string,
) {
  const supabase = createClient();
  const channelName = channelSuffix
    ? `session-${sessionId}-${channelSuffix}`
    : `session-${sessionId}`;

  const channel = supabase
    .channel(channelName)
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: TABLE,
        filter: `id=eq.${sessionId}`,
      },
      (payload) => {
        const row = payload.new as Session;
        if (row.signaling_data) {
          onSignaling(row.signaling_data as unknown as SignalingData);
        }
        if (onStatusChange && row.pc_status) {
          onStatusChange(row.pc_status);
        }
      },
    )
    .subscribe();

  return channel;
}
