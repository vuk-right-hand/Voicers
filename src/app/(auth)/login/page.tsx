"use client";

import { useState, useRef, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import type { SupabaseClient, RealtimeChannel } from "@supabase/supabase-js";

type Screen = "auth" | "waiting";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [screen, setScreen] = useState<Screen>("auth");
  const [copied, setCopied] = useState(false);
  const [resendStatus, setResendStatus] = useState<string>("idle");
  const [verifyUrl, setVerifyUrl] = useState("https://voicers.vercel.app/verify");

  const supabaseRef = useRef<SupabaseClient | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);

  // On mount: if a session already exists, branch immediately —
  // linked → dashboard, unlinked → restore PKCE waiting room
  useEffect(() => {
    const supabase = createClient();
    supabaseRef.current = supabase;
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) return;
      if (session.user.user_metadata?.device_b_linked_at) {
        window.location.replace("/dashboard");
        return;
      }
      // Session exists but Device B not linked yet — restore waiting room
      const provider = session.user.app_metadata?.provider ?? "email";
      setVerifyUrl(buildVerifyUrl(provider, session.user.email));
      setScreen("waiting");
      setupRealtimeListener(supabase, session.user.id);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const buildVerifyUrl = (provider: string, userEmail?: string | null) => {
    const base = "https://voicers.vercel.app/verify";
    const p = provider === "email" ? "email" : provider; // github | google | email
    if (provider === "email" && userEmail) {
      return `${base}?p=email&e=${encodeURIComponent(userEmail)}`;
    }
    return `${base}?p=${p}`;
  };

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
      const supabase = createClient();
      supabaseRef.current = supabase;
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

      // New or unlinked session — fire the "connect second device" email,
      // then show the PKCE waiting room as a fallback
      const url = buildVerifyUrl("email", email);
      setVerifyUrl(url);
      setStatus(null);
      setLoading(false);
      setScreen("waiting");
      setupRealtimeListener(supabase, session.user.id);

      // Fire and forget — if Resend fails, modal is still the fallback
      fetch("/api/send-verify-email", { method: "POST" }).catch(() => null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setStatus(null);
      setLoading(false);
    }
  };

  // ─── Realtime listener ───────────────────────────────────────────────────────

  const setupRealtimeListener = (supabase: SupabaseClient, userId: string) => {
    // Unsubscribe any existing channel before creating a new one (#5)
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }

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
            window.location.replace("/dashboard");
          }
        }
      )
      .subscribe();

    channelRef.current = channel;
  };

  // ─── Render: PKCE waiting room ───────────────────────────────────────────────

  if (screen === "waiting") {
    const isEmailPath = verifyUrl.includes("?p=email");

    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-black p-6 text-white">
        <h1 className="text-3xl font-bold">Voicer</h1>

        <div className="relative flex w-full max-w-sm flex-col gap-6 rounded-2xl border border-zinc-800 bg-zinc-950 p-6">
          <button
            onClick={() => setScreen("auth")}
            className="absolute right-4 top-4 flex h-7 w-7 items-center justify-center rounded-full text-zinc-600 hover:text-zinc-300"
            aria-label="Dismiss"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>

          <div className="flex flex-col gap-2 pr-6">
            <p className="font-semibold text-white">Connect your second device</p>
            {isEmailPath ? (
              <p className="text-sm text-zinc-400 leading-relaxed">
                We&apos;ve sent a connection link to your inbox. Open it on your second device and tap the button inside.
              </p>
            ) : (
              <p className="text-sm text-zinc-400 leading-relaxed">
                To establish a Proof Key for Code Exchange (PKCE), type this URL on your second device:
              </p>
            )}
          </div>

          {/* Manual fallback URL — always shown */}
          <div>
            {isEmailPath && (
              <p className="mb-2 text-xs text-zinc-600">Or type this URL manually:</p>
            )}
            <div className="flex items-center gap-3 rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3">
              <span className="flex-1 truncate font-mono text-sm text-white">
                {verifyUrl.replace("https://", "")}
              </span>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(verifyUrl);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
                className={`shrink-0 transition-colors ${copied ? "text-green-400" : "text-zinc-500 hover:text-zinc-300"}`}
                title="Copy full URL"
              >
                {copied ? (
                  <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          <p className="animate-pulse text-center text-xs text-zinc-600">
            Waiting for the other device to connect…
          </p>

          {isEmailPath && (
            <button
              onClick={async () => {
                setResendStatus("sending");
                try {
                  const res = await fetch("/api/send-verify-email", { method: "POST" });
                  if (!res.ok) {
                    const text = await res.text();
                    setResendStatus(`error: ${text || "Unknown"}`);
                  } else {
                    setResendStatus("sent");
                  }
                } catch (e: any) {
                  setResendStatus(`error: Network fail`);
                }
                setTimeout(() => setResendStatus("idle"), 4000);
              }}
              disabled={resendStatus === "sending"}
              className="text-xs text-zinc-600 hover:text-zinc-400 disabled:opacity-50 transition-colors"
            >
              {resendStatus === "sending" && "Sending…"}
              {resendStatus === "sent" && <span className="text-green-500">Email sent ✓</span>}
              {resendStatus.startsWith("error") && <span className="text-red-400">Failed: {resendStatus.replace("error: ", "")}</span>}
              {resendStatus === "idle" && "Didn't get the email? Resend"}
            </button>
          )}
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
            onPointerDown={(e) => {
              e.preventDefault();
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
    </main>
  );
}
