"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Screen = "form" | "sent";

// ─── Inner component (needs useSearchParams → must be inside Suspense) ─────────

function VerifyContent() {
  const searchParams = useSearchParams();
  const provider = searchParams.get("p") ?? "email"; // "email" | "github" | "google"
  const emailParam = searchParams.get("e") ?? "";    // pre-filled from the Resend link

  const [email, setEmail] = useState(emailParam);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [screen, setScreen] = useState<Screen>("form");

  // ─── OAuth ─────────────────────────────────────────────────────────────────
  // No ?next param → callback defaults to /session → stamps device_b_linked_at

  const handleOAuth = async (oauthProvider: "github" | "google") => {
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: oauthProvider,
      options: { redirectTo: `${window.location.origin}/callback` },
    });
  };

  // ─── Magic link ────────────────────────────────────────────────────────────

  const handleSendLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { error: otpError } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: `${window.location.origin}/callback`,
      },
    });

    if (otpError) {
      setError(otpError.message);
      setLoading(false);
      return;
    }

    setLoading(false);
    setScreen("sent");
  };

  // ─── Sent confirmation ─────────────────────────────────────────────────────

  if (screen === "sent") {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-black p-6 text-white">
        <h1 className="text-3xl font-bold">Voicer</h1>
        <div className="flex flex-col items-center gap-4 text-center max-w-xs">
          <div className="flex h-12 w-12 items-center justify-center rounded-full border border-zinc-700">
            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-400">
              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
              <polyline points="22,6 12,13 2,6" />
            </svg>
          </div>
          <p className="text-lg font-semibold">Check your inbox</p>
          <p className="text-sm text-zinc-400 leading-relaxed">
            We sent a connection link to <span className="text-white">{email}</span>.
            Tap it to connect this device.
          </p>
          <button
            onClick={() => { setScreen("form"); setError(null); }}
            className="text-sm text-zinc-500 hover:text-zinc-300"
          >
            ← Try a different email
          </button>
        </div>
      </main>
    );
  }

  // ─── GitHub-only view ──────────────────────────────────────────────────────

  if (provider === "github") {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-black p-6 text-white">
        <h1 className="text-3xl font-bold">Voicer</h1>
        <p className="text-zinc-400 text-center max-w-xs">
          Sign in with the same GitHub account you used on your other device.
        </p>
        <div className="w-full max-w-sm">
          <button
            type="button"
            onClick={() => handleOAuth("github")}
            className="flex w-full items-center justify-center gap-3 rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm font-medium text-white transition-colors hover:border-zinc-500 active:scale-95"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
            </svg>
            Continue with GitHub
          </button>
        </div>
      </main>
    );
  }

  // ─── Google-only view ──────────────────────────────────────────────────────

  if (provider === "google") {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-black p-6 text-white">
        <h1 className="text-3xl font-bold">Voicer</h1>
        <p className="text-zinc-400 text-center max-w-xs">
          Sign in with the same Google account you used on your other device.
        </p>
        <div className="w-full max-w-sm">
          <button
            type="button"
            onClick={() => handleOAuth("google")}
            className="flex w-full items-center justify-center gap-3 rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm font-medium text-white transition-colors hover:border-zinc-500 active:scale-95"
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
      </main>
    );
  }

  // ─── Email / default view ──────────────────────────────────────────────────

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-black p-6 text-white">
      <h1 className="text-3xl font-bold">Voicer</h1>
      <p className="text-zinc-400 text-center max-w-xs">
        Enter your email to receive a secure connection link.
      </p>

      <form onSubmit={handleSendLink} className="flex w-full max-w-sm flex-col gap-4">
        <input
          type="email"
          placeholder="Email you signed up with"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
          className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-white placeholder-zinc-500 outline-none focus:border-zinc-500"
        />

        {error && <p className="text-sm text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="rounded-xl bg-white px-6 py-3 font-semibold text-black transition-transform active:scale-95 disabled:opacity-50"
        >
          {loading ? "..." : "Send connection link"}
        </button>
      </form>
    </main>
  );
}

// ─── Page wrapper (required for useSearchParams) ───────────────────────────────

export default function VerifyPage() {
  return (
    <Suspense>
      <VerifyContent />
    </Suspense>
  );
}
