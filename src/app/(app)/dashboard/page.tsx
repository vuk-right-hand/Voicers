"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { fetchActiveSession, subscribeToSession } from "@/lib/webrtc/signaling";
import { useSessionStore } from "@/hooks/use-session";
import QRCode from "react-qr-code";
import { InstallBanner } from "@/components/install-banner";
import type { Session, SignalingData } from "@/types";

const APP_URL = "https://voicers.vercel.app/dashboard";

export default function DashboardPage() {
  const router = useRouter();
  const { connectToHost, transportStatus } = useSessionStore();
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    setIsDesktop(!/Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent));
  }, []);
  const [session, setSession] = useState<Session | null>(null);
  const [hostReady, setHostReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);

  // Get authenticated user + check plan
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) {
        router.push("/login");
        return;
      }
      setUserId(user.id);

      // Check if subscription has expired (plan reverted to free by webhook)
      const { data: profile } = await supabase
        .from("profiles")
        .select("plan")
        .eq("id", user.id)
        .single();

      if (profile?.plan === "free") {
        // Only gate users whose subscription was explicitly canceled/unpaid.
        // This lets gifted users (plan set manually, no sub) and dev accounts through.
        const { data: sub } = await supabase
          .from("subscriptions")
          .select("status")
          .eq("user_id", user.id)
          .in("status", ["canceled", "unpaid"])
          .limit(1)
          .single();

        if (sub) {
          setExpired(true);
          setLoading(false);
          return;
        }
      }
    });
  }, [router]);

  // Fetch active session once we have user ID
  useEffect(() => {
    if (!userId) return;
    let channel: ReturnType<typeof subscribeToSession> | null = null;
    let currentSessionId: string | null = null;
    let resyncing = false;

    function parseHostReady(data: Session): boolean {
      const raw = data.signaling_data;
      const sig: SignalingData | null =
        typeof raw === "string" ? JSON.parse(raw) : (raw as unknown as SignalingData | null);
      return sig?.type === "host-ready" || data.pc_status === "waiting";
    }

    async function load() {
      try {
        const { data } = await fetchActiveSession(userId!);
        if (data) {
          currentSessionId = data.id;
          setSession(data);
          setHostReady(parseHostReady(data));

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
      } finally {
        setLoading(false);
      }
    }

    // Full re-sync: tear down old Realtime channel, re-fetch session, re-subscribe.
    // Resets UI to "Looking for your rig..." so stale "offline" is never shown.
    async function resync() {
      if (resyncing) return;
      resyncing = true;
      channel?.unsubscribe();
      channel = null;
      setLoading(true);
      setHostReady(false);

      try {
        const { data } = await fetchActiveSession(userId!);
        if (!data) {
          setSession(null);
          setHostReady(false);
          return;
        }
        currentSessionId = data.id;
        setSession(data);
        setHostReady(parseHostReady(data));

        channel = subscribeToSession(
          data.id,
          (sigData) => setHostReady(sigData.type === "host-ready"),
          (status) => {
            if (status === "waiting") setHostReady(true);
            else if (status === "offline") setHostReady(false);
          },
        );
      } finally {
        setLoading(false);
        resyncing = false;
      }
    }

    load();

    // Re-sync when app comes back to foreground (after being killed / backgrounded)
    const onVisibility = () => {
      if (document.visibilityState === "visible") resync();
    };
    document.addEventListener("visibilitychange", onVisibility);

    // Also re-sync on PWA focus (covers cases where visibilitychange doesn't fire)
    const onFocus = () => resync();
    window.addEventListener("focus", onFocus);

    // Polling fallback: re-fetch every 3s to catch any missed Realtime updates.
    const poll = setInterval(async () => {
      const { data } = await fetchActiveSession(userId!);
      if (!data) return;
      setHostReady(parseHostReady(data));
      // If session ID changed (host restarted), do a full resync for new Realtime sub
      if (data.id !== currentSessionId) resync();
    }, 3000);

    return () => {
      channel?.unsubscribe();
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
    };
  }, [userId]);

  const handleConnect = () => {
    if (!session) return;
    const sig = session.signaling_data as SignalingData | null;
    const iceServers = sig?.type === "host-ready" ? sig.ice_servers : undefined;
    connectToHost(session.id, iceServers);
    router.push("/session");
  };

  // TURN status from host signaling (for BYOK error feedback)
  const turnStatus = (() => {
    if (!session) return "none";
    const sig = session.signaling_data as SignalingData | null;
    return sig?.type === "host-ready" ? (sig.turn_status ?? "none") : "none";
  })();


  const isConnecting = transportStatus === "signaling" || transportStatus === "connecting";

  // ─── Expired subscription gate ────────────────────────────────────────────────
  if (expired) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-6 p-6 text-center">
        <h1 className="text-3xl font-bold tracking-tight">Voicer</h1>
        <p className="text-zinc-400 max-w-xs leading-relaxed">
          Your subscription has ended. Resubscribe to reconnect to your rig.
        </p>
        <a
          href="/#pricing"
          className="rounded-2xl bg-white px-8 py-4 text-lg font-semibold text-black transition-transform active:scale-95"
        >
          View plans
        </a>
        <a
          href="/settings"
          className="text-sm text-zinc-600 hover:text-zinc-400"
        >
          Manage account
        </a>
      </main>
    );
  }

  // ─── Desktop view ─────────────────────────────────────────────────────────────
  if (isDesktop) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-10 bg-black p-6 text-white">
        <h1 className="text-3xl font-bold">Voicer</h1>
        <div className="flex flex-col items-center gap-3 text-center">
          <p className="text-lg font-semibold">Open Voicer on your phone</p>
          <p className="font-mono text-sm text-zinc-500">{APP_URL.replace("https://", "")}</p>
        </div>
        <div className="rounded-2xl bg-white p-4">
          <QRCode value={APP_URL} size={200} bgColor="#ffffff" fgColor="#000000" />
        </div>
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 p-6">
      <InstallBanner />
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

      {turnStatus === "error" && (
        <p className="text-xs text-red-400 max-w-xs text-center">
          TURN error — check your API keys in the desktop host. Local network only.
        </p>
      )}
    </main>
  );
}
