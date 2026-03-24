"use client";

import { useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useSessionStore } from "@/hooks/use-session";
import { POCKET_MODE_BG } from "@/lib/constants";

export default function SessionPage() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const {
    mediaStream,
    transportStatus,
    isPocketMode,
    sendCommand,
    disconnect,
    togglePocketMode,
  } = useSessionStore();

  // Attach MediaStream to <video> element — no Object URLs, no re-renders
  useEffect(() => {
    if (videoRef.current && mediaStream) {
      videoRef.current.srcObject = mediaStream;
      videoRef.current.play().catch(() => {});
    }
  }, [mediaStream]);

  // Redirect to dashboard if not connected
  useEffect(() => {
    if (transportStatus === "idle" && !mediaStream) {
      // Small delay to allow initial connection
      const t = setTimeout(() => {
        if (useSessionStore.getState().transportStatus === "idle") {
          router.replace("/dashboard");
        }
      }, 3000);
      return () => clearTimeout(t);
    }
  }, [transportStatus, mediaStream, router]);

  // Tap handler — normalize coords relative to video element
  const handleTap = useCallback(
    (e: React.PointerEvent<HTMLVideoElement>) => {
      const video = videoRef.current;
      if (!video) return;

      const rect = video.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;

      sendCommand({ type: "tap", x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) });
    },
    [sendCommand],
  );

  const handleDisconnect = () => {
    disconnect();
    router.replace("/dashboard");
  };

  // Pocket mode: OLED black screen, double-tap to restore
  if (isPocketMode) {
    return (
      <main
        className="fixed inset-0"
        style={{ backgroundColor: POCKET_MODE_BG }}
        onDoubleClick={togglePocketMode}
      />
    );
  }

  const statusLabel =
    transportStatus === "signaling"
      ? "Signaling..."
      : transportStatus === "connecting"
        ? "Connecting..."
        : transportStatus === "failed"
          ? "Connection failed"
          : null;

  return (
    <main className="relative flex flex-1 items-center justify-center bg-black" style={{ touchAction: "none" }}>
      {/* Video stream */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="h-full w-full object-contain"
        onPointerUp={handleTap}
      />

      {/* Connection status overlay */}
      {statusLabel && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/70">
          <p className="text-lg text-white">{statusLabel}</p>
        </div>
      )}

      {/* Controls overlay */}
      <div className="absolute bottom-6 right-6 flex gap-3">
        <button
          onClick={togglePocketMode}
          className="rounded-full bg-zinc-800/80 px-4 py-2 text-sm text-white backdrop-blur"
          type="button"
        >
          Pocket
        </button>
        <button
          onClick={handleDisconnect}
          className="rounded-full bg-red-600/80 px-4 py-2 text-sm text-white backdrop-blur"
          type="button"
        >
          Disconnect
        </button>
      </div>
    </main>
  );
}
