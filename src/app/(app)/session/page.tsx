"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSessionStore } from "@/hooks/use-session";
import { useGestures } from "@/hooks/use-gestures";
import { CommsButton } from "@/components/comms-button";
import { POCKET_MODE_BG } from "@/lib/constants";

export default function SessionPage() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const {
    mediaStream,
    transportStatus,
    isPocketMode,
    dataChannel,
    sendCommand,
    disconnect,
    togglePocketMode,
  } = useSessionStore();

  const { gestureState, zoomStyle, zoomPercent, bind } = useGestures(videoRef, sendCommand);

  // Attach MediaStream to <video> element.
  // Re-runs when exiting pocket mode because the video element remounts (new DOM node).
  useEffect(() => {
    if (videoRef.current && mediaStream) {
      videoRef.current.srcObject = mediaStream;
      videoRef.current.play().catch(() => {});
    }
  }, [mediaStream, isPocketMode]);

  // Redirect to dashboard if not connected
  useEffect(() => {
    if (transportStatus === "idle" && !mediaStream) {
      const t = setTimeout(() => {
        if (useSessionStore.getState().transportStatus === "idle") {
          router.replace("/dashboard");
        }
      }, 3000);
      return () => clearTimeout(t);
    }
  }, [transportStatus, mediaStream, router]);

  const handleDisconnect = () => {
    disconnect();
    router.replace("/dashboard");
  };

  // Pocket mode state
  const [pocketButtonVisible, setPocketButtonVisible] = useState(false);
  const [pocketToast, setPocketToast] = useState(false);
  const lastTapTime = useRef(0);

  // Reset pocket button state when entering pocket mode
  useEffect(() => {
    if (isPocketMode) {
      setPocketButtonVisible(false);
      setPocketToast(true);
      lastTapTime.current = 0;
      const t = setTimeout(() => setPocketToast(false), 2000);
      return () => clearTimeout(t);
    }
  }, [isPocketMode]);

  // Pocket mode: OLED black screen, double-tap to show button, tap button to restore
  if (isPocketMode) {
    return (
      <main
        className="fixed inset-0 select-none"
        style={{
          backgroundColor: POCKET_MODE_BG,
          touchAction: "none",
          WebkitUserSelect: "none",
          userSelect: "none",
        }}
        onTouchEnd={(e) => {
          // Double-tap detection on finger lift (more reliable than touchstart on mobile)
          e.preventDefault();
          const now = Date.now();
          if (now - lastTapTime.current < 400) {
            // Double-tap detected
            lastTapTime.current = 0;
            if (pocketButtonVisible) {
              setPocketButtonVisible(false);
              togglePocketMode();
            } else {
              setPocketButtonVisible(true);
            }
          } else {
            lastTapTime.current = now;
          }
        }}
        onTouchStart={(e) => e.preventDefault()}
        onTouchMove={(e) => e.preventDefault()}
        onContextMenu={(e) => e.preventDefault()}
      >
        {/* Toast on enter */}
        {pocketToast && (
          <div className="absolute inset-x-0 bottom-12 flex justify-center pointer-events-none">
            <p className="rounded-full bg-white/10 px-4 py-2 text-sm text-white/60 backdrop-blur animate-fade-out">
              Double-tap to bring me back.
            </p>
          </div>
        )}

        {/* Pocket restore button — appears on first double-tap */}
        {pocketButtonVisible && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <button
              className="rounded-full bg-zinc-800/80 px-6 py-3 text-sm text-white backdrop-blur pointer-events-auto"
              type="button"
              onTouchEnd={(e) => {
                e.stopPropagation();
                setPocketButtonVisible(false);
                togglePocketMode();
              }}
              onClick={(e) => {
                e.stopPropagation();
                setPocketButtonVisible(false);
                togglePocketMode();
              }}
            >
              Exit Pocket Mode
            </button>
          </div>
        )}
      </main>
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
    <main className="relative flex items-center justify-center bg-black" style={{ height: "100dvh" }}>
      {/* Gesture wrapper — outer div owns bounds, video gets the zoom transform */}
      <div
        className="h-full w-full overflow-hidden"
        style={{ touchAction: "none" }}
        {...bind}
      >
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="h-full w-full object-contain"
          style={zoomStyle}
        />
      </div>

      {/* Zoom indicator */}
      {gestureState === "zoomed" && (
        <div className="absolute left-4 top-4 rounded-full bg-white/20 px-3 py-1 text-xs text-white backdrop-blur">
          ZOOM {zoomPercent}% — tap to click, 2-finger to cancel
        </div>
      )}

      {/* Connection status overlay */}
      {statusLabel && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/70">
          <p className="text-lg text-white">{statusLabel}</p>
        </div>
      )}

      {/* Controls overlay */}
      <div className="absolute top-4 right-4 flex gap-3">
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

      {/* Voice Comms Button */}
      <CommsButton dataChannel={dataChannel} sendCommand={sendCommand} />
    </main>
  );
}
