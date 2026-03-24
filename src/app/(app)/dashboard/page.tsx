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
      const { data, error } = await fetchActiveSession(userId!);
      if (data) {
        setSession(data);
        const raw = data.signaling_data;
        const sig: SignalingData | null =
          typeof raw === "string" ? JSON.parse(raw) : (raw as unknown as SignalingData | null);
        setHostReady(sig?.type === "host-ready");

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
    return () => { channel?.unsubscribe(); };
  }, [userId]);

  const handleConnect = () => {
    if (!session) return;
    connectToHost(session.id);
    router.push("/session");
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
        <div className="flex flex-col items-center gap-3">
          <div className="h-3 w-3 rounded-full bg-red-500" />
          <p className="text-zinc-400">Desktop host is offline</p>
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
