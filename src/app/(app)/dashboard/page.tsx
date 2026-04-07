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

  // ── TURN config (BYOK, stored in localStorage) ──────────────────────────
  const [turnOpen, setTurnOpen] = useState(false);
  const [turnApiUrl, setTurnApiUrl] = useState("");
  const [turnApiKey, setTurnApiKey] = useState("");

  useEffect(() => {
    setTurnApiUrl(localStorage.getItem("voicer_turn_api_url") ?? "");
    setTurnApiKey(localStorage.getItem("voicer_turn_api_key") ?? "");
  }, []);

  const saveTurn = () => {
    if (turnApiUrl.trim() && turnApiKey.trim()) {
      localStorage.setItem("voicer_turn_api_url", turnApiUrl.trim());
      localStorage.setItem("voicer_turn_api_key", turnApiKey.trim());
    } else {
      localStorage.removeItem("voicer_turn_api_url");
      localStorage.removeItem("voicer_turn_api_key");
    }
    setTurnOpen(false);
  };

  // Get authenticated user + check plan
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) {
        router.push("/login");
        return;
      }
      setUserId(user.id);

      // Check if subscription has expired (plan reverted to free)
      const { data: profile } = await supabase
        .from("profiles")
        .select("plan")
        .eq("id", user.id)
        .single();

      if (profile?.plan === "free") {
        // Check if they ever had a subscription (lapsed vs never-subscribed)
        const { data: sub } = await supabase
          .from("subscriptions")
          .select("id")
          .eq("user_id", user.id)
          .limit(1)
          .single();

        if (sub) {
          // Lapsed subscriber — show resubscribe gate
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

    async function load() {
      try {
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
      } finally {
        setLoading(false);
      }
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

      {/* ── TURN Server config (for 4G / CGNAT) ────────────────────────────── */}
      <div className="w-full max-w-xs">
        <button
          type="button"
          onClick={() => setTurnOpen((o) => !o)}
          className="w-full text-xs text-zinc-600 flex items-center justify-between px-3 py-2 rounded-xl hover:bg-zinc-900 transition-colors"
        >
          <span>TURN Server {turnApiKey ? <span className="text-green-500 ml-1">●</span> : <span className="text-zinc-700 ml-1">○</span>}</span>
          <span>{turnOpen ? "▲" : "▼"}</span>
        </button>
        {turnOpen && (
          <div className="mt-2 flex flex-col gap-2 bg-zinc-900 rounded-2xl p-4">
            <p className="text-xs text-zinc-500">Required for 4G. Paste your metered.ca credentials API URL and key.</p>
            <input
              type="text"
              placeholder="https://yourapp.metered.live/api/v1/turn/credentials"
              value={turnApiUrl}
              onChange={(e) => setTurnApiUrl(e.target.value)}
              className="rounded-lg bg-zinc-800 px-3 py-2 text-xs text-white placeholder:text-zinc-600 outline-none"
            />
            <input
              type="password"
              placeholder="API Key"
              value={turnApiKey}
              onChange={(e) => setTurnApiKey(e.target.value)}
              className="rounded-lg bg-zinc-800 px-3 py-2 text-xs text-white placeholder:text-zinc-600 outline-none"
            />
            <button
              type="button"
              onClick={saveTurn}
              className="rounded-xl bg-white px-4 py-2 text-xs font-semibold text-black active:scale-95 transition-transform"
            >
              Save
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
