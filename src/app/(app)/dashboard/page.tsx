export default function DashboardPage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 p-6">
      <h1 className="text-3xl font-bold tracking-tight">Voicer</h1>
      <p className="text-lg text-zinc-400">
        Voice-first remote controller for vibe coding
      </p>
      <button
        className="rounded-2xl bg-white px-8 py-4 text-lg font-semibold text-black transition-transform active:scale-95"
        type="button"
      >
        Connect to my rig
      </button>
    </main>
  );
}
