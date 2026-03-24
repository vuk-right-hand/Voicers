"use client";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-black p-6 text-white">
      <h1 className="text-3xl font-bold">Voicer</h1>
      <p className="text-zinc-400">Sign in to start vibe coding from your phone</p>

      <div className="flex w-full max-w-sm flex-col gap-3">
        {/* Phase 2: Magic link form */}
        <button
          className="rounded-xl bg-white px-6 py-3 font-semibold text-black transition-transform active:scale-95"
          type="button"
          disabled
        >
          Continue with Email
        </button>

        <div className="flex items-center gap-3 text-zinc-500">
          <div className="h-px flex-1 bg-zinc-800" />
          <span className="text-sm">or</span>
          <div className="h-px flex-1 bg-zinc-800" />
        </div>

        {/* Phase 2: Google OAuth */}
        <button
          className="rounded-xl border border-zinc-700 px-6 py-3 font-semibold transition-transform active:scale-95"
          type="button"
          disabled
        >
          Continue with Google
        </button>

        {/* Phase 2: GitHub OAuth */}
        <button
          className="rounded-xl border border-zinc-700 px-6 py-3 font-semibold transition-transform active:scale-95"
          type="button"
          disabled
        >
          Continue with GitHub
        </button>
      </div>
    </main>
  );
}
