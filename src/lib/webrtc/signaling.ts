/**
 * WebRTC Signaling via Supabase Realtime
 *
 * Uses the `sessions` table to exchange SDP offers/answers and ICE candidates
 * between the phone (PWA) and the desktop host.
 *
 * Flow:
 * 1. Desktop host creates a session row with pc_status = 'waiting'
 * 2. Phone subscribes to Realtime changes on that session
 * 3. SDP offer/answer and ICE candidates are exchanged via signaling_data JSONB
 * 4. Once connected, pc_status updates to 'connected'
 * 5. All subsequent data flows over WebRTC (not through Supabase)
 */

// TODO: Implement signaling helpers in next phase
export const SIGNALING_CHANNEL = "sessions";
