/**
 * Active session page — shows the desktop stream and control overlay.
 * Stub for Phase 1. Will contain:
 * - WebRTC video stream viewer
 * - Comms button (double-tap = dictate, hold = command)
 * - Sniper zoom gesture layer
 * - Pocket mode toggle
 */
export default function SessionPage() {
  return (
    <main className="relative flex flex-1 items-center justify-center bg-black">
      <p className="text-zinc-500">
        Stream will appear here when connected to your rig.
      </p>
    </main>
  );
}
