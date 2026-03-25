"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setStatus("Authenticating...");

    try {
      const supabase = createClient();
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

      // Auth succeeded — verify session is actually set
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setError("Auth succeeded but no session was created. Check Supabase email confirmation settings.");
        setStatus(null);
        setLoading(false);
        return;
      }

      setStatus("Logged in! Redirecting...");
      // Full page load so the server-side proxy sees the auth cookie
      window.location.replace("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setStatus(null);
      setLoading(false);
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-black p-6 text-white">
      <h1 className="text-3xl font-bold">Voicer</h1>
      <p className="text-zinc-400">
        {isSignUp ? "Create your account" : "Sign in to start vibe coding from your phone"}
      </p>

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
              // preventDefault on pointerdown stops the browser from blurring
              // the input (which would dismiss the mobile keyboard)
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
          onClick={() => {
            setIsSignUp(!isSignUp);
            setError(null);
          }}
          className="text-sm text-zinc-500 hover:text-zinc-300"
        >
          {isSignUp ? "Already have an account? Sign in" : "Need an account? Sign up"}
        </button>
      </form>
    </main>
  );
}
