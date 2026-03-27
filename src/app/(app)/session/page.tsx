"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSessionStore, awaitClipboard } from "@/hooks/use-session";
import { useGestures } from "@/hooks/use-gestures";
import type { Rect } from "@/hooks/use-gestures";
import { CommsButton } from "@/components/comms-button";
import { POCKET_MODE_BG, TOAST_DISMISS_MS } from "@/lib/constants";

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
    screenWidth,
    screenHeight,
    remoteCursorPos,
  } = useSessionStore();

  // ─── Orientation detection ─────────────────────────────────────────────────

  const [isLandscape, setIsLandscape] = useState(false);
  useEffect(() => {
    const check = () => setIsLandscape(window.innerWidth > window.innerHeight);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // ─── Mode toggle ──────────────────────────────────────────────────────────

  const [mode, setMode] = useState<"voice" | "trackpad">("voice");

  // ─── Trackpad & Scroll rects ──────────────────────────────────────────────

  const trackpadRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [trackpadRect, setTrackpadRect] = useState<Rect | null>(null);
  const [scrollRect, setScrollRect] = useState<Rect | null>(null);

  // Recompute rects on mode/orientation changes and on resize
  const updateRects = useCallback(() => {
    if (trackpadRef.current) {
      const r = trackpadRef.current.getBoundingClientRect();
      setTrackpadRect({ left: r.left, top: r.top, width: r.width, height: r.height });
    } else {
      setTrackpadRect(null);
    }
    if (scrollRef.current) {
      const r = scrollRef.current.getBoundingClientRect();
      setScrollRect({ left: r.left, top: r.top, width: r.width, height: r.height });
    } else {
      setScrollRect(null);
    }
  }, []);

  useEffect(() => {
    // Small delay to let DOM settle after mode/orientation change
    const t = setTimeout(updateRects, 50);
    window.addEventListener("resize", updateRects);
    return () => {
      clearTimeout(t);
      window.removeEventListener("resize", updateRects);
    };
  }, [mode, isLandscape, updateRects]);

  // ─── Extraction toast (Copy) ──────────────────────────────────────────────

  const [extractionToast, setExtractionToast] = useState(false);
  const [fetchedText, setFetchedText] = useState("");
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── Paste pill ───────────────────────────────────────────────────────────

  const [copiedText, setCopiedText] = useState("");

  const triggerExtraction = async () => {
    setExtractionToast(true);
    setFetchedText("");
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => {
      setExtractionToast(false);
      setFetchedText("");
    }, TOAST_DISMISS_MS);

    // Fire Ctrl+C on the PC
    sendCommand({ type: "command", action: "shortcut", payload: { keys: ["ctrl", "c"] } });
    await new Promise((r) => setTimeout(r, 150));

    // Fetch clipboard and stash for synchronous read
    sendCommand({ type: "get-clipboard" });
    const text = await awaitClipboard();
    setFetchedText(text);
  };

  const dismissToast = () => {
    setExtractionToast(false);
    setFetchedText("");
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
  };

  /** 100% synchronous — no awaits. Safari-safe. */
  const handleCopy = () => {
    if (!fetchedText) {
      dismissToast();
      return;
    }

    try {
      navigator.clipboard.writeText(fetchedText);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = fetchedText;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }

    // Stash text, snap back to voice — pill activates automatically
    setCopiedText(fetchedText);
    dismissToast();
    setMode("voice");
  };

  const handlePaste = async () => {
    let textToPaste = "";

    // Try to read phone's current clipboard first (user copied from Safari, Notes, etc)
    try {
      textToPaste = await navigator.clipboard.readText();
    } catch {
      // Fallback to stored copiedText if clipboard read fails or permission denied
      textToPaste = copiedText;
    }

    if (textToPaste) {
      sendCommand({ type: "type-text", text: textToPaste });
    }
    setCopiedText("");
  };

  // ─── Gestures ─────────────────────────────────────────────────────────────

  const { zoomStyle, zoomPercent, cursorPos, bind } = useGestures(
    videoRef,
    sendCommand,
    mode,
    { width: screenWidth, height: screenHeight },
    triggerExtraction,
    triggerExtraction,
    scrollRect,
    trackpadRect,
  );

  // ─── Video attach ─────────────────────────────────────────────────────────

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

  // ─── Pocket mode ──────────────────────────────────────────────────────────

  const [pocketButtonVisible, setPocketButtonVisible] = useState(false);
  const [pocketToast, setPocketToast] = useState(false);
  const lastTapTime = useRef(0);

  useEffect(() => {
    if (isPocketMode) {
      setPocketButtonVisible(false);
      setPocketToast(true);
      lastTapTime.current = 0;
      const t = setTimeout(() => setPocketToast(false), 2000);
      return () => clearTimeout(t);
    }
  }, [isPocketMode]);

  // ─── WakeLock — hold screen on in pocket mode ─────────────────────────────

  useEffect(() => {
    if (!isPocketMode) return;
    let wakeLock: WakeLockSentinel | null = null;
    navigator.wakeLock?.request("screen").then((wl) => { wakeLock = wl; }).catch(() => {});
    return () => { wakeLock?.release().catch(() => {}); };
  }, [isPocketMode]);

  const statusLabel =
    transportStatus === "signaling"
      ? "Signaling..."
      : transportStatus === "connecting"
        ? "Connecting..."
        : transportStatus === "failed"
          ? "Connection failed"
          : null;

  // ─── Copy toast position — straddles top/left edge of trackpad ──────────
  // Portrait: bottom 25% is trackpad top edge → toast straddles it (50% in, 50% out)
  // Landscape: right 20% is trackpad left edge → toast straddles it (50% in, 50% out)
  const copyToastPosition: React.CSSProperties = isLandscape
    ? { right: "20%", top: "75%", transform: "translate(50%, -50%)" }
    : { bottom: "25%", left: "50%", transform: "translate(-50%, 50%)" };

  return (
    <main className="relative flex items-center justify-center bg-black" style={{ height: "100dvh", touchAction: "none" }}>
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

      {/* ── Mode toggle pill — top-left ────────────────────────────────────── */}
      <div className="absolute top-4 left-4 z-20 flex rounded-full bg-zinc-800/80 backdrop-blur p-1">
        <button
          type="button"
          onClick={() => setMode("voice")}
          className={`rounded-full px-4 py-1.5 text-sm transition-colors ${
            mode === "voice" ? "bg-white text-black font-medium" : "text-white/60"
          }`}
        >
          👂
        </button>
        <button
          type="button"
          onClick={() => setMode("trackpad")}
          className={`rounded-full px-4 py-1.5 text-sm transition-colors ${
            mode === "trackpad" ? "bg-white text-black font-medium" : "text-white/60"
          }`}
        >
          🖱️
        </button>
      </div>

      {/* ── Zoom indicator — portrait only, landscape has no space ─────────── */}
      {zoomPercent > 0 && !isLandscape && (
        <div className="absolute left-4 top-14 rounded-full bg-white/20 px-3 py-1 text-xs text-white backdrop-blur">
          {zoomPercent}% — pinch to adjust
        </div>
      )}

      {/* ── Connection status overlay ──────────────────────────────────────── */}
      {statusLabel && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/70">
          <p className="text-lg text-white">{statusLabel}</p>
        </div>
      )}

      {/* ── Controls (Pocket + Disconnect) — orientation-aware ─────────────── */}
      {isLandscape ? (
        // Landscape: stack vertically on the left, below mode toggle
        <div className="absolute top-16 left-4 z-20 flex flex-col gap-2">
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
          {/* Paste pill — permanent active color (always ready for on-demand clipboard injection) */}
          <button
            type="button"
            onClick={handlePaste}
            onTouchEnd={(e) => { e.stopPropagation(); handlePaste(); }}
            className="rounded-full px-4 py-2 text-sm font-semibold bg-white text-black transition-all duration-200 active:scale-95"
          >
            Paste
          </button>
        </div>
      ) : (
        // Portrait: top-right, stacked vertically
        <div className="absolute top-4 right-4 z-20 flex flex-col gap-2">
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
          {/* Paste pill — permanent active color (always ready for on-demand clipboard injection) */}
          <button
            type="button"
            onClick={handlePaste}
            onTouchEnd={(e) => { e.stopPropagation(); handlePaste(); }}
            className="rounded-full px-4 py-2 text-sm font-semibold bg-white text-black transition-all duration-200 active:scale-95"
          >
            Paste
          </button>
        </div>
      )}

      {/* ── Scroll widget — right edge, hollow silver, both modes ─────────── */}
      {/* pointerEvents:none → touches fall through to gesture wrapper beneath  */}
      {/* Landscape: right 5%, top 75% (leaves room for comms button below)     */}
      {/* Portrait:  right 5%, bottom 25% (aligns with trackpad)                */}
      <div
        ref={scrollRef}
        className="absolute z-10 flex items-center justify-center border border-white/40 bg-transparent"
        style={{
          pointerEvents: "none",
          ...(isLandscape
            ? { right: 0, top: 0, width: "5%", height: "75%", borderRadius: "0 0 0 12px" }
            : { right: 0, bottom: 0, width: "5%", height: "25%", borderRadius: "12px 0 0 0" }),
        }}
      >
        {/* Stacked letters — S on top, L at bottom */}
        <div className="flex flex-col items-center">
          {"SCROLL".split("").map((letter, i) => (
            <span key={i} className="text-white/50 text-[9px] font-semibold select-none leading-tight">
              {letter}
            </span>
          ))}
        </div>
      </div>

      {/* ── Trackpad widget (mouse mode only) ──────────────────────────────── */}
      {/* pointerEvents:none on visuals → touches fall through to gesture wrapper */}
      {/* Landscape: right 5%–20% (scroll strip occupies rightmost 5%)           */}
      {/* Portrait:  bottom 25%, full width minus rightmost 5% (scroll strip)    */}
      {mode === "trackpad" && (
        isLandscape ? (
          <div
            ref={trackpadRef}
            className="absolute top-0 bottom-0 z-10"
            style={{ right: "5%", width: "15%", pointerEvents: "none" }}
          >
            <div className="relative h-full w-full rounded-l-2xl border border-white/15 bg-white/5 backdrop-blur-sm overflow-hidden">
              {/* Diagonal label */}
              <div className="absolute inset-0 flex items-center justify-center">
                <span
                  className="text-white/10 text-xs font-medium tracking-widest select-none"
                  style={{ transform: "rotate(45deg)", whiteSpace: "nowrap" }}
                >
                  trackpad
                </span>
              </div>
            </div>
          </div>
        ) : (
          <div
            ref={trackpadRef}
            className="absolute bottom-0 left-0 z-10"
            style={{ right: "5%", height: "25%", pointerEvents: "none" }}
          >
            <div className="relative h-full rounded-tr-2xl border border-white/15 bg-white/5 backdrop-blur-sm overflow-hidden">
              {/* Diagonal label */}
              <div className="absolute inset-0 flex items-center justify-center">
                <span
                  className="text-white/10 text-xs font-medium tracking-widest select-none"
                  style={{ transform: "rotate(45deg)", whiteSpace: "nowrap" }}
                >
                  trackpad
                </span>
              </div>
            </div>
          </div>
        )
      )}

      {/* ── Extraction (Copy) toast — trackpad mode only ──────────────────── */}
      {mode === "trackpad" && extractionToast && (
        <>
          {/* Invisible fullscreen overlay — tap outside = dismiss */}
          <div
            className="absolute inset-0 z-20"
            onTouchEnd={(e) => { e.stopPropagation(); dismissToast(); }}
            onClick={() => dismissToast()}
          />
          {/* Copy toast — straddles trackpad border */}
          <div
            className="absolute z-30"
            style={copyToastPosition}
          >
            <button
              type="button"
              onTouchEnd={(e) => { e.stopPropagation(); handleCopy(); }}
              onClick={handleCopy}
              className="rounded-2xl bg-white px-6 py-3 text-sm font-semibold text-black shadow-xl active:scale-95"
              style={{ minWidth: 100, minHeight: 48 }}
            >
              {fetchedText ? "Copy" : "..."}
            </button>
          </div>
        </>
      )}


      {/* ── Trackpad cursor overlay (mouse mode) ───────────────────────────── */}
      {/* Prefers host-broadcast position (remoteCursorPos, normalized 0–1 from pyautogui) */}
      {/* Falls back to client-side gesture tracking (cursorPos, in PC pixels)             */}
      {mode === "trackpad" && (() => {
        // Resolve normalized cursor position (0–1 range)
        const normPos = remoteCursorPos
          ?? (cursorPos && screenWidth > 0 && screenHeight > 0
            ? { x: cursorPos.x / screenWidth, y: cursorPos.y / screenHeight }
            : null);
        if (!normPos) return null;

        const video = videoRef.current;
        if (!video) return null;
        const vr = video.getBoundingClientRect();
        const vw = video.videoWidth || screenWidth;
        const vh = video.videoHeight || screenHeight;
        if (!vw || !vh) return null;
        const videoAspect = vw / vh;
        const elemAspect = vr.width / vr.height;
        let contentLeft = vr.left, contentTop = vr.top, contentW = vr.width, contentH = vr.height;
        if (videoAspect > elemAspect) {
          contentH = vr.width / videoAspect;
          contentTop = vr.top + (vr.height - contentH) / 2;
        } else {
          contentW = vr.height * videoAspect;
          contentLeft = vr.left + (vr.width - contentW) / 2;
        }
        const dotX = contentLeft + normPos.x * contentW;
        const dotY = contentTop + normPos.y * contentH;
        return (
          <div
            key="cursor"
            className="absolute z-30 pointer-events-none"
            style={{ left: dotX, top: dotY, transform: "translate(-3px, -3px)" }}
          >
            {/* Standard arrow cursor — tip aligns with dotX/dotY, black outline for any bg */}
            <svg width="9" height="11" viewBox="0 0 14 17" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path
                d="M1.5 1.5 L1.5 13.5 L4.5 10.5 L6.5 15.5 L8.5 14.8 L6.5 9.8 L10.5 9.8 Z"
                fill="white"
                stroke="rgba(0,0,0,0.85)"
                strokeWidth="1"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            </svg>
          </div>
        );
      })()}

      {/* ── Comms Button — voice mode only ─────────────────────────────────── */}
      {mode === "voice" && (
        <CommsButton
          dataChannel={dataChannel}
          sendCommand={sendCommand}
          isLandscape={isLandscape}
          positionClassName={isLandscape ? "bottom-8 right-8" : "bottom-6 left-1/2 -translate-x-1/2"}
        />
      )}

      {/* ── Pocket Mode Overlay — rendered on top, keeps component tree alive ── */}
      {isPocketMode && (
        <div
          className="fixed inset-0 z-[9999] select-none"
          style={{
            backgroundColor: POCKET_MODE_BG,
            touchAction: "none",
            WebkitUserSelect: "none",
            userSelect: "none",
          }}
          onTouchEnd={(e) => {
            e.preventDefault();
            const now = Date.now();
            if (now - lastTapTime.current < 400) {
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
          {pocketToast && (
            <div className="absolute inset-x-0 bottom-12 flex justify-center pointer-events-none">
              <p className="rounded-full bg-white/10 px-4 py-2 text-sm text-white/60 backdrop-blur">
                Double-tap to bring me back.
              </p>
            </div>
          )}
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
        </div>
      )}
    </main>
  );
}
