"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { fetchActiveSession, subscribeToSession } from "@/lib/webrtc/signaling";
import { useSessionStore } from "@/hooks/use-session";
import type { Session, SignalingData } from "@/types";

export default function DashboardPage() {
  const router = useRouter();
  const { connectToHost, transportStatus } = useSessionStore();
  const [session, setSession] = useState<Session | null>(null);
  const [hostReady, setHostReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [isWaking, setIsWaking] = useState(false);
  const [wakeError, setWakeError] = useState<string | null>(null);
  // Elapsed seconds since we first observed the offline state.
  // Ghost-press protection uses this instead of server timestamps to avoid
  // phone clock skew (a ±2min drift would bypass the 10s threshold entirely).
  const [offlineSec, setOfflineSec] = useState(0);

  // Get authenticated user
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) {
        router.push("/login");
        return;
      }
      setUserId(user.id);
    });
  }, [router]);

  // Fetch active session once we have user ID
  useEffect(() => {
    if (!userId) return;
    let channel: ReturnType<typeof subscribeToSession> | null = null;

    async function load() {
      const { data } = await fetchActiveSession(userId!);
      if (data) {
        setSession(data);
        const raw = data.signaling_data;
        const sig: SignalingData | null =
          typeof raw === "string" ? JSON.parse(raw) : (raw as unknown as SignalingData | null);
        // Accept either signaling_data.type === "host-ready" OR pc_status === "waiting" —
        // the host writes these in two separate DB calls so a fetch between them would
        // miss the signaling flag but still see the status.
        setHostReady(sig?.type === "host-ready" || data.pc_status === "waiting");

        // Subscribe for live updates
        channel = subscribeToSession(
          data.id,
          (sigData) => setHostReady(sigData.type === "host-ready"),
          (status) => {
            if (status === "waiting") setHostReady(true);
            else if (status === "offline") setHostReady(false);
          },
        );
      }
      setLoading(false);
    }

    load();

    // Polling fallback: if Realtime fires before our subscription is ready we'd
    // miss the update and stay stuck on "offline". Re-fetch every 5s until ready.
    const poll = setInterval(async () => {
      const { data } = await fetchActiveSession(userId!);
      if (!data) return;
      const raw = data.signaling_data;
      const sig: SignalingData | null =
        typeof raw === "string" ? JSON.parse(raw) : (raw as unknown as SignalingData | null);
      setHostReady(sig?.type === "host-ready" || data.pc_status === "waiting");
    }, 5000);

    return () => {
      channel?.unsubscribe();
      clearInterval(poll);
    };
  }, [userId]);

  const handleConnect = () => {
    if (!session) return;
    connectToHost(session.id);
    router.push("/session");
  };

  // Ghost-press protection: start a local timer the moment we observe offline state.
  // After 10 continuous seconds of offline, the Wake button becomes available.
  // Uses local elapsed time instead of server timestamps to avoid phone clock skew
  // (a ±2min drift on session.last_ping would silently bypass the guard entirely).
  useEffect(() => {
    if (hostReady || loading) {
      setOfflineSec(0);
      return;
    }
    setOfflineSec(0);
    const id = setInterval(() => setOfflineSec((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [hostReady, loading]);

  const canWake = !hostReady && !loading && session !== null && offlineSec >= 10;

  const handleWakeHost = async () => {
    if (isWaking || !canWake) return;
    setIsWaking(true);
    setWakeError(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.functions.invoke("wake-host");
      if (error) throw error;
      // Button stays disabled for 30s — enough time for the PC to start booting.
      // The realtime subscription will flip hostReady → true when the host comes online.
      setTimeout(() => setIsWaking(false), 30_000);
    } catch {
      setWakeError("Wake signal failed. Check SwitchBot config in settings.");
      setIsWaking(false);
    }
  };

  const isConnecting = transportStatus === "signaling" || transportStatus === "connecting";

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 p-6">
      <h1 className="text-3xl font-bold tracking-tight">Voicer</h1>

      {loading ? (
        <p className="text-zinc-500">Looking for your rig...</p>
      ) : !session ? (
        <p className="text-zinc-500">
          No session found. Start the desktop host first.
        </p>
      ) : !hostReady ? (
        <div className="flex flex-col items-center gap-4">
          <div className="h-3 w-3 rounded-full bg-red-500" />
          <p className="text-zinc-400">Desktop host is offline</p>
          {/* Wake button: only rendered when last_ping confirms sustained offline (>10s).
              Prevents ghost-pressing the power button on a briefly-disconnected live PC. */}
          {canWake && (
            <div className="flex flex-col items-center gap-2">
              <button
                type="button"
                onClick={handleWakeHost}
                disabled={isWaking}
                className="rounded-2xl bg-zinc-800 px-6 py-3 text-sm font-semibold text-white transition-transform active:scale-95 disabled:opacity-50 disabled:active:scale-100"
              >
                {isWaking ? "Waking…" : "⚡ Wake Host"}
              </button>
              {isWaking && (
                <p className="text-xs text-zinc-500">Signal sent — waiting for host to come online…</p>
              )}
              {wakeError && (
                <p className="text-xs text-red-400">{wakeError}</p>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-4">
          <div className="h-3 w-3 rounded-full bg-green-500 animate-pulse" />
          <p className="text-zinc-400">Desktop host is ready</p>
          <button
            onClick={handleConnect}
            disabled={isConnecting}
            className="rounded-2xl bg-white px-8 py-4 text-lg font-semibold text-black transition-transform active:scale-95 disabled:opacity-50"
            type="button"
          >
            {isConnecting ? "Connecting..." : "Connect to my rig"}
          </button>
        </div>
      )}
    </main>
  );
}
