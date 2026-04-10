"use client";

import { useState, useRef, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import QRCode from "react-qr-code";
import type { SupabaseClient, RealtimeChannel } from "@supabase/supabase-js";

type AuthProvider = "email" | "github" | "google";

type Screen = "auth" | "waiting" | "linking";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [screen, setScreen] = useState<Screen>("auth");
  const [resendStatus, setResendStatus] = useState<string>("idle");
  const [authProvider, setAuthProvider] = useState<AuthProvider>("email");
  const [resendMode, setResendMode] = useState(false);

  const supabaseRef = useRef<SupabaseClient | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const lastEmailSentRef = useRef<number>(0);

  useEffect(() => {
    const supabase = createClient();
    supabaseRef.current = supabase;

    const hash = window.location.hash;
    const isImplicitDeviceB =
      hash.includes("access_token") && hash.includes("type=magiclink");

    // ─── DEVICE B: explicit hash parsing ──────────────────────────────────
    // admin.generateLink() produces an implicit-flow link. Supabase redirects
    // to /login#access_token=...&refresh_token=...&type=magiclink
    // We parse the tokens ourselves and force-set the session — no race conditions.
    if (isImplicitDeviceB) {
      setScreen("linking");

      const params = new URLSearchParams(hash.substring(1)); // strip leading #
      const accessToken = params.get("access_token");
      const refreshToken = params.get("refresh_token");

      if (!accessToken || !refreshToken) {
        setError("Invalid link — please request a new one from your other device.");
        setScreen("auth");
        return;
      }

      supabase.auth
        .setSession({ access_token: accessToken, refresh_token: refreshToken })
        .then(async ({ data: { session }, error: sessionError }) => {
          if (sessionError || !session) {
            setError("Link expired or invalid — please request a new one.");
            setScreen("auth");
            return;
          }

          const linkedAt = new Date().toISOString();
          await Promise.all([
            supabase
              .from("profiles")
              .update({ device_b_linked_at: linkedAt })
              .eq("id", session.user.id),
            supabase.auth.updateUser({
              data: { device_b_linked_at: linkedAt },
            }),
          ]);

          window.location.replace("/dashboard");
        })
        .catch(() => {
          setError("Something went wrong — please try the link again.");
          setScreen("auth");
        });

      // Clean the hash from the URL bar (cosmetic)
      window.history.replaceState(null, "", window.location.pathname);
      return; // skip regular flow & cleanup — no subscription to unsubscribe
    }

      // ─── Handle ?resend=true from expired magic link email ──────────────
    const searchParams = new URLSearchParams(window.location.search);
    if (searchParams.get("resend") === "true") {
      setResendMode(true);
      window.history.replaceState(null, "", window.location.pathname);
      // Don't return — still set up onAuthStateChange below so an existing
      // session gets detected and the user is redirected automatically.
    }

    // ─── Handle ?plan= from pricing page ──────────────────────────────────
    const planParam = searchParams.get("plan");
    if (planParam === "byok" || planParam === "pro") {
      // Store in localStorage with TTL so it survives tab close + auth redirects
      localStorage.setItem("voicer_checkout_plan", JSON.stringify({
        plan: planParam,
        expires: Date.now() + 30 * 60 * 1000, // 30 minutes
      }));
    }

    // ─── Handle ?error from failed OAuth callback ──────────────────────────
    const authError = searchParams.get("error");
    if (authError) {
      setError("Authentication failed. Please try again.");
      window.history.replaceState(null, "", window.location.pathname);
    }

    // ─── DEVICE A: regular session detection ──────────────────────────────
    let handled = false;

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (handled) return;
      if (event !== "INITIAL_SESSION" && event !== "SIGNED_IN") return;
      if (!session) return;

      handled = true;

      // Already linked → dashboard
      if (session.user.user_metadata?.device_b_linked_at) {
        window.location.replace("/dashboard");
        return;
      }

      // Detect auth provider from session metadata
      const provider = session.user.app_metadata?.provider as string | undefined;
      if (provider === "github" || provider === "google") {
        setAuthProvider(provider);
      }

      // Check if user came from pricing page with a plan to checkout
      const stored = localStorage.getItem("voicer_checkout_plan");
      if (stored) {
        try {
          const { plan, expires } = JSON.parse(stored);
          localStorage.removeItem("voicer_checkout_plan");
          if (Date.now() < expires && (plan === "pro" || plan === "byok")) {
            const priceId = plan === "pro"
              ? process.env.NEXT_PUBLIC_STRIPE_PRICE_PRO
              : process.env.NEXT_PUBLIC_STRIPE_PRICE_BYOK;
            if (priceId) {
              fetch("/api/stripe/checkout", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ priceId }),
              })
                .then(res => res.json())
                .then(data => {
                  if (data.url) window.location.href = data.url;
                })
                .catch(() => {
                  window.location.replace("/settings");
                });
              return;
            }
          }
        } catch {
          localStorage.removeItem("voicer_checkout_plan");
        }
      }

      // No pending plan → waiting room
      setScreen("waiting");
      setupRealtimeListener(supabase, session.user.id);
      fetch("/api/send-verify-email", { method: "POST" }).catch(() => null);
    });

    return () => {
      subscription.unsubscribe();
      if (channelRef.current) {
        clearInterval((channelRef.current as any)._pollInterval);
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── OAuth (Device A) ─────────────────────────────────────────────────────────
  // Pass ?next=/login so the callback skips stamping device_b_linked_at and
  // redirects back here — the useEffect above will detect the unlinked session
  // and render the PKCE waiting room with the correct ?p= URL.

  const handleOAuth = async (provider: "github" | "google") => {
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${window.location.origin}/callback?next=/login`,
      },
    });
  };

  // ─── Email + Password ────────────────────────────────────────────────────────

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setStatus("Authenticating...");

    try {
      const supabase = supabaseRef.current!;
      let authError: { message: string } | null = null;

      if (isSignUp) {
        const { error: err } = await supabase.auth.signUp({ email, password });
        authError = err;
      } else {
        const { error: err } = await supabase.auth.signInWithPassword({ email, password });
        authError = err;
      }

      if (authError) {
        setError(authError.message);
        setStatus(null);
        setLoading(false);
        return;
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setError("Auth succeeded but no session was created. Check Supabase email confirmation settings.");
        setStatus(null);
        setLoading(false);
        return;
      }

      // Already linked (returning user) — go straight to dashboard
      if (session.user.user_metadata?.device_b_linked_at) {
        window.location.replace("/dashboard");
        return;
      }

      // Check if user came from pricing page with a plan to checkout
      const stored = localStorage.getItem("voicer_checkout_plan");
      if (stored) {
        try {
          const { plan, expires } = JSON.parse(stored);
          localStorage.removeItem("voicer_checkout_plan");
          if (Date.now() < expires && (plan === "pro" || plan === "byok")) {
            const priceId = plan === "pro"
              ? process.env.NEXT_PUBLIC_STRIPE_PRICE_PRO
              : process.env.NEXT_PUBLIC_STRIPE_PRICE_BYOK;
            if (priceId) {
              setStatus("Redirecting to checkout...");
              const res = await fetch("/api/stripe/checkout", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ priceId }),
              });
              const data = await res.json();
              if (data.url) {
                window.location.href = data.url;
                return;
              }
            }
          }
        } catch {
          localStorage.removeItem("voicer_checkout_plan");
        }
      }

      // No pending plan → waiting room
      setStatus(null);
      setLoading(false);
      setScreen("waiting");
      setupRealtimeListener(supabase, session.user.id);
      fetch("/api/send-verify-email", { method: "POST" }).catch(() => null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setStatus(null);
      setLoading(false);
    }
  };

  // ─── Realtime listener ───────────────────────────────────────────────────────

  const setupRealtimeListener = (supabase: SupabaseClient, userId: string) => {
    // Clean up any existing channel + poll interval before creating new ones
    if (channelRef.current) {
      clearInterval((channelRef.current as any)._pollInterval);
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }

    const redirectToDashboard = () => window.location.replace("/dashboard");

    // ── Primary: Realtime postgres_changes ────────────────────────────────
    const channel = supabase
      .channel(`device-link-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "profiles",
          filter: `id=eq.${userId}`,
        },
        (payload) => {
          if ((payload.new as { device_b_linked_at?: string }).device_b_linked_at) {
            redirectToDashboard();
          }
        }
      )
      .subscribe();

    channelRef.current = channel;

    // ── Fallback: poll every 3s in case Realtime event was missed ─────────
    // This handles backgrounded tabs, network blips and Realtime cold-start delays.
    const pollInterval = setInterval(async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user?.user_metadata?.device_b_linked_at) {
        clearInterval(pollInterval);
        redirectToDashboard();
      }
    }, 3000);

    // Store cleanup on the channel ref so the component can clear it too
    (channel as any)._pollInterval = pollInterval;
  };

  // ─── Render: Resend magic link screen ────────────────────────────────────────

  if (resendMode) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-black p-6 text-white">
        <h1 className="text-3xl font-bold">Voicer</h1>

        <div className="flex w-full max-w-sm flex-col items-center gap-6 rounded-2xl border border-zinc-800 bg-zinc-950 p-6">
          <div className="text-center">
            <p className="font-semibold">Link expired?</p>
            <p className="mt-1 text-sm text-zinc-400">Sign in to get a fresh verification email.</p>
          </div>

          <button
            type="button"
            onClick={() => { setResendMode(false); setError(null); }}
            className="rounded-xl bg-white px-6 py-3 font-semibold text-black transition-transform active:scale-95 w-full"
          >
            Sign in
          </button>

          <p className="text-xs text-zinc-600 text-center">
            Signing in automatically re-sends the verification email.
          </p>
        </div>
      </main>
    );
  }

  // ─── Render: Device B linking screen ─────────────────────────────────────────

  if (screen === "linking") {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-black p-6 text-white">
        <h1 className="text-3xl font-bold">Voicer</h1>
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-white" />
          <p className="text-zinc-400">Connecting your device…</p>
        </div>
      </main>
    );
  }

  // ─── Render: waiting room ────────────────────────────────────────────────────

  if (screen === "waiting") {
    const isMobile = typeof navigator !== "undefined" && /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    const isOAuth = authProvider === "github" || authProvider === "google";
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://voicers.vercel.app";
    const qrUrl = `${siteUrl}/verify?p=${authProvider}`;

    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-black p-6 text-white">
        <h1 className="text-3xl font-bold">Voicer</h1>

        <div className="relative flex w-full max-w-sm flex-col items-center gap-6 rounded-2xl border border-zinc-800 bg-zinc-950 p-6">
          <button
            onClick={() => setScreen("auth")}
            className="absolute right-4 top-4 flex h-7 w-7 items-center justify-center rounded-full text-zinc-600 hover:text-zinc-300"
            aria-label="Dismiss"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>

          <div className="flex flex-col gap-2 text-center">
            <p className="font-semibold text-white">Connect your other device</p>
            <p className="text-sm text-zinc-400 leading-relaxed">
              {isOAuth
                ? isMobile
                  ? "Scan the QR code on your desktop or check your inbox for a connection link."
                  : "Scan the QR code on your phone or check your inbox for a connection link."
                : isMobile
                  ? "Check your inbox on your desktop for a connection link."
                  : "Check your inbox on your phone for a connection link."}
            </p>
          </div>

          {/* QR code — only for OAuth users (points to /verify?p=github|google) */}
          {isOAuth && (
            <div className="rounded-xl bg-white p-3 inline-block">
              <QRCode value={qrUrl} size={180} />
            </div>
          )}

          <p className="animate-pulse text-center text-xs text-zinc-600">
            Waiting for the other device to connect…
          </p>

          <button
            onClick={async () => {
              const now = Date.now();
              const hourMs = 60 * 60 * 1000;

              // Silent rate limit: 1 real send per hour, fake success after that
              if (now - lastEmailSentRef.current < hourMs) {
                setResendStatus("sent");
                setTimeout(() => setResendStatus("idle"), 4000);
                return;
              }

              setResendStatus("sending");
              try {
                const res = await fetch("/api/send-verify-email", { method: "POST" });
                if (res.ok) {
                  lastEmailSentRef.current = now;
                }
                // Always show success — don't leak API errors to the user
                setResendStatus("sent");
              } catch {
                setResendStatus("sent");
              }
              setTimeout(() => setResendStatus("idle"), 4000);
            }}
            disabled={resendStatus === "sending"}
            className="text-xs text-zinc-600 hover:text-zinc-400 disabled:opacity-50 transition-colors"
          >
            {resendStatus === "sending" && "Sending…"}
            {resendStatus === "sent" && <span className="text-green-500">Check your inbox (and spam)</span>}
            {resendStatus === "idle" && "Didn't get the email? Resend"}
          </button>
        </div>
      </main>
    );
  }

  // ─── Render: auth screen ─────────────────────────────────────────────────────

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-black p-6 text-white">
      <h1 className="text-3xl font-bold">Voicer</h1>
      <p className="text-zinc-400">
        {isSignUp ? "Create your account" : "Sign in to start vibe coding from your phone"}
      </p>

      {/* OAuth */}
      <div className="flex w-full max-w-sm flex-col gap-3">
        <button
          type="button"
          onClick={() => handleOAuth("github")}
          className="flex items-center justify-center gap-3 rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm font-medium text-white transition-colors hover:border-zinc-500 active:scale-95"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
          </svg>
          Continue with GitHub
        </button>

        <button
          type="button"
          onClick={() => handleOAuth("google")}
          className="flex items-center justify-center gap-3 rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm font-medium text-white transition-colors hover:border-zinc-500 active:scale-95"
        >
          <svg width="18" height="18" viewBox="0 0 24 24">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
          Continue with Google
        </button>
      </div>

      <div className="flex w-full max-w-sm items-center gap-3">
        <div className="h-px flex-1 bg-zinc-800" />
        <span className="text-xs text-zinc-600">or continue with email</span>
        <div className="h-px flex-1 bg-zinc-800" />
      </div>

      {/* Email + Password */}
      <form onSubmit={handleSubmit} className="flex w-full max-w-sm flex-col gap-4">
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-white placeholder-zinc-500 outline-none focus:border-zinc-500"
        />

        <div className="relative">
          <input
            type={showPassword ? "text" : "password"}
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 pr-14 text-white placeholder-zinc-500 outline-none focus:border-zinc-500"
          />
          <button
            type="button"
            tabIndex={-1}
            onTouchEnd={(e) => {
              e.preventDefault(); // prevents mousedown→focus-shift→keyboard-dismiss
              setShowPassword((prev) => !prev);
            }}
            onMouseDown={(e) => {
              e.preventDefault(); // desktop: prevents input blur
              setShowPassword((prev) => !prev);
            }}
            className="absolute right-0 top-0 z-10 flex h-full w-14 items-center justify-center text-zinc-500 active:text-zinc-300"
          >
            {showPassword ? (
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                <line x1="1" y1="1" x2="23" y2="23" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            )}
          </button>
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}
        {status && <p className="text-sm text-blue-400">{status}</p>}

        <button
          type="submit"
          disabled={loading}
          className="rounded-xl bg-white px-6 py-3 font-semibold text-black transition-transform active:scale-95 disabled:opacity-50"
        >
          {loading ? "..." : isSignUp ? "Sign Up" : "Sign In"}
        </button>

        <button
          type="button"
          onClick={() => { setIsSignUp(!isSignUp); setError(null); }}
          className="text-sm text-zinc-500 hover:text-zinc-300"
        >
          {isSignUp ? "Already have an account? Sign in" : "Need an account? Sign up"}
        </button>
      </form>

      <div className="flex items-center gap-4 text-xs text-zinc-600">
        <a href="/privacy" className="hover:text-zinc-400 transition-colors">Privacy Policy</a>
        <span className="text-zinc-800">|</span>
        <a href="/tos" className="hover:text-zinc-400 transition-colors">Terms of Service</a>
      </div>
    </main>
  );
}
