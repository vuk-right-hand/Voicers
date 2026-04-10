"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSessionStore, awaitClipboard } from "@/hooks/use-session";
import { useGestures } from "@/hooks/use-gestures";
import type { Rect } from "@/hooks/use-gestures";
import { CommsButton } from "@/components/comms-button";
import { KeyboardOverlay } from "@/components/keyboard-overlay";
import { POCKET_MODE_BG, TOAST_DISMISS_MS } from "@/lib/constants";
import { useVoiceStore } from "@/hooks/use-voice";

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
    setIsPocketMode,
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

  // ─── Keyboard overlay ─────────────────────────────────────────────────────

  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false);
  
  // Auto-close keyboard when flipping to landscape
  useEffect(() => {
    if (isLandscape && isKeyboardOpen) {
      setIsKeyboardOpen(false);
    }
  }, [isLandscape, isKeyboardOpen]);

  const keyboardTextareaRef = useRef<HTMLTextAreaElement>(null);

  // Synchronous focus BEFORE state update — satisfies iOS user-gesture requirement.
  // The textarea is always mounted (just hidden via CSS), so the ref is always valid.
  const openKeyboard = () => {
    keyboardTextareaRef.current?.focus({ preventScroll: true });
    setIsKeyboardOpen(true);
  };

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
  const [infectToast, setInfectToast] = useState(false);
  const [fetchedText, setFetchedText] = useState("");
  const [copiedConfirm, setCopiedConfirm] = useState(false);
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

  /** Synchronous-first copy. Safari-safe. */
  const handleCopy = () => {
    if (!fetchedText) {
      dismissToast();
      return;
    }

    // execCommand is synchronous and needs no permissions dialog — run it first
    // so the copy is guaranteed even if the async clipboard API is unavailable.
    try {
      const ta = document.createElement("textarea");
      ta.value = fetchedText;
      ta.style.cssText = "position:fixed;left:-9999px;opacity:0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    } catch { /* silent — browser may have removed execCommand */ }

    // Best-effort: also write via modern clipboard API. The .catch() is required —
    // writeText() returns a Promise; without it, a permission denial is an unhandled
    // rejection that silently bypasses the execCommand fallback above.
    navigator.clipboard?.writeText(fetchedText).catch(() => {});

    // Stash text — show checkmark confirmation then fade
    setCopiedText(fetchedText);
    setCopiedConfirm(true);
    setTimeout(() => {
      dismissToast();
      setCopiedConfirm(false);
      if (mode === "trackpad") setMode("voice");
    }, 600);
  };

  const handleSelectAll = async () => {
    // Select All on PC, then re-copy so fetchedText has the full selection
    sendCommand({ type: "command", action: "shortcut", payload: { keys: ["ctrl", "a"] } });
    await new Promise((r) => setTimeout(r, 200)); // let selection land
    setFetchedText("");
    sendCommand({ type: "command", action: "shortcut", payload: { keys: ["ctrl", "c"] } });
    await new Promise((r) => setTimeout(r, 150));
    sendCommand({ type: "get-clipboard" });
    const text = await awaitClipboard();
    setFetchedText(text);
    // Reset dismiss timer so user has time to tap Copy
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => {
      setExtractionToast(false);
      setFetchedText("");
    }, TOAST_DISMISS_MS);
  };

  const handlePaste = async () => {
    let textToPaste = "";

    // Prefer in-memory copy (reliable) over phone clipboard read (can return
    // stale/truncated data on mobile Safari when the clipboard write silently fails).
    if (copiedText) {
      textToPaste = copiedText;
    } else {
      // No in-app copy — try phone clipboard (user copied from Safari, Notes, etc)
      try {
        textToPaste = await navigator.clipboard.readText();
      } catch {
        // Permission denied or unavailable — nothing to paste
      }
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

  // Redirect to dashboard if not connected or rejected
  useEffect(() => {
    if (transportStatus === "rejected") {
      router.replace("/dashboard");
      return;
    }
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
  const [showPocketWarning, setShowPocketWarning] = useState(false);
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

  // ─── Auto-Pocket Mode Timer ───────────────────────────────────────────────

  useEffect(() => {
    let warningTimer: ReturnType<typeof setTimeout> | null = null;
    let activationTimer: ReturnType<typeof setTimeout> | null = null;
    
    const isConnected = transportStatus === "connected";

    if (!isConnected || isPocketMode) {
      if (warningTimer) clearTimeout(warningTimer);
      if (activationTimer) clearTimeout(activationTimer);
      setShowPocketWarning(false);
      return;
    }

    const triggerWarning = () => {
      setShowPocketWarning(true);
      activationTimer = setTimeout(() => {
        setShowPocketWarning(false);
        setIsPocketMode(true);
      }, 10000); // 10s grace period
    };

    const resetTimers = () => {
      if (warningTimer) clearTimeout(warningTimer);
      if (activationTimer) clearTimeout(activationTimer);
      setShowPocketWarning(false);
      warningTimer = setTimeout(triggerWarning, 110000); // 110s idle
    };

    resetTimers(); // Start clock initially

    const interactionEvents = ['touchstart', 'touchmove', 'click', 'scroll'];
    interactionEvents.forEach(event => {
      document.addEventListener(event, resetTimers, { passive: true });
    });

    return () => {
      if (warningTimer) clearTimeout(warningTimer);
      if (activationTimer) clearTimeout(activationTimer);
      interactionEvents.forEach(event => {
        document.removeEventListener(event, resetTimers);
      });
    };
  }, [transportStatus, isPocketMode, setIsPocketMode]);

  // ─── WakeLock — hold screen on while connected ────────────────────────────

  useEffect(() => {
    let wakeLock: any = null;
    const isConnected = transportStatus === "connected";

    // Need to cast to any internally to soothe TS if WakeLock isn't fully supported
    const nav = navigator as any;

    const requestWakeLock = async () => {
      if ("wakeLock" in navigator && isConnected) {
        try {
          wakeLock = await nav.wakeLock.request("screen");
          wakeLock?.addEventListener("release", () => {
            // OS released it (e.g., app minimized)
          });
        } catch (err) {
          // blocked by device state (low battery) or permissions
        }
      }
    };

    if (isConnected) {
      requestWakeLock();
    } else if (wakeLock) {
      wakeLock.release().then(() => {
        wakeLock = null;
      }).catch(() => {});
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible" && isConnected) {
        requestWakeLock();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (wakeLock) {
        wakeLock.release().catch(() => {});
      }
    };
  }, [transportStatus]);

  // ─── Settings modal ───────────────────────────────────────────────────────

  const [settingsOpen, setSettingsOpen] = useState(false);
  const modalTouchStartY = useRef(0);
  const modalDidScroll = useRef(false);

  const statusLabel =
    transportStatus === "signaling"
      ? "Signaling..."
      : transportStatus === "connecting"
        ? "Connecting..."
        : transportStatus === "reconnecting"
          ? "Reconnecting..."
          : transportStatus === "failed"
            ? "Connection failed"
            : transportStatus === "rejected"
              ? "Subscription expired"
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

      {/* ── Mode toggle pill — portrait only (landscape embeds it in left column) */}
      {!isLandscape && (
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
      )}

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

      {/* ── Gear (+ mode toggle + paste in landscape) ──────────────────────── */}
      {/* Portrait: gear + paste row, top-right. Landscape: full left column, top-left. */}
      <div
        className={`absolute z-20 flex gap-2 ${
          isLandscape ? "top-4 left-4 flex-col items-start" : "top-4 right-4 flex-row items-center"
        }`}
      >
        {/* Settings gear */}
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-800/80 text-white backdrop-blur active:scale-90 transition-transform"
          aria-label="Settings"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
        </button>
        {/* Mode toggle — landscape only (portrait renders it separately top-left) */}
        {isLandscape && (
          <div className="flex rounded-full bg-zinc-800/80 backdrop-blur p-1">
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
        )}
        {/* Paste pill — always-on: pastes phone clipboard or in-app copied text */}
        <button
          type="button"
          onClick={handlePaste}
          onTouchEnd={(e) => { e.stopPropagation(); }}
          className="rounded-full px-4 py-2 text-sm font-semibold bg-white text-black transition-all duration-200 active:scale-95"
        >
          Paste
        </button>
        {/* Keyboard toggle - disabled in landscape per user request */}
        {!isLandscape && (
          <button
            type="button"
            onClick={openKeyboard}
            onTouchEnd={(e) => { e.stopPropagation(); }}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-800/80 text-white backdrop-blur active:scale-90 transition-transform"
            aria-label="Open keyboard"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="6" width="20" height="12" rx="2"/>
              <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8"/>
            </svg>
          </button>
        )}
      </div>

      {/* ── Settings modal ──────────────────────────────────────────────────── */}
      {settingsOpen && (
        <div
          className="fixed inset-0 z-[9998] flex items-center justify-center"
          style={{ backdropFilter: "blur(12px)", backgroundColor: "rgba(0,0,0,0.6)", touchAction: "none" }}
          onClick={() => setSettingsOpen(false)}
          onTouchStart={(e) => e.stopPropagation()}
          onTouchMove={(e) => e.stopPropagation()}
          onTouchEnd={(e) => { e.stopPropagation(); setSettingsOpen(false); }}
        >
          <div
            className="relative w-[min(360px,88vw)] max-h-[calc(100dvh-3rem)] flex flex-col rounded-3xl bg-zinc-900/90 shadow-2xl border border-white/10 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
            onTouchMove={(e) => e.stopPropagation()}
            onTouchEnd={(e) => e.stopPropagation()}
          >
            {/* Header — sticky, never scrolls away */}
            <div className="flex-shrink-0 flex items-center justify-between px-6 pt-6 pb-4 border-b border-white/10">
              <h2 className="text-base font-semibold text-white">Settings</h2>
              <button
                type="button"
                onClick={() => setSettingsOpen(false)}
                onTouchEnd={(e) => { e.stopPropagation(); setSettingsOpen(false); }}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-white/60 active:scale-90 transition-transform"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M18 6L6 18M6 6l12 12"/>
                </svg>
              </button>
            </div>

            {/* Scrollable body — tracks touch movement to distinguish scroll from tap */}
            <div
              className="flex-1 overflow-y-auto overscroll-contain px-6 py-5 flex flex-col gap-4"
              onTouchStart={(e) => { e.stopPropagation(); modalTouchStartY.current = e.touches[0].clientY; modalDidScroll.current = false; }}
              onTouchMove={(e) => { e.stopPropagation(); if (Math.abs(e.touches[0].clientY - modalTouchStartY.current) > 6) modalDidScroll.current = true; }}
            >
              {/* Actions */}
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    if (infectToast) return;
                    try {
                      if (navigator.share) await navigator.share({ title: "Voicer", text: "Voice-code from your phone. Seriously.", url: "https://voicers.vercel.app" });
                      else await navigator.clipboard.writeText("https://voicers.vercel.app");
                    } catch { /* cancelled */ }
                    setInfectToast(true);
                    setTimeout(() => setInfectToast(false), 3000);
                  }}
                  onTouchEnd={(e) => { e.stopPropagation(); }}
                  className={`w-full rounded-2xl px-4 py-3 text-left text-sm transition-colors flex items-center gap-2 ${
                    infectToast
                      ? "bg-green-500 text-black"
                      : "bg-yellow-400 text-black active:bg-yellow-300"
                  }`}
                >
                  {infectToast ? (
                    <>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      <span className="font-semibold">Recruit another addict :)</span>
                    </>
                  ) : (
                    <>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
                        <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                      </svg>
                      <span className="font-semibold">Infect a friend</span>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => { if (!modalDidScroll.current) { setSettingsOpen(false); togglePocketMode(); } }}
                  onTouchEnd={(e) => { e.stopPropagation(); }}
                  className="w-full rounded-2xl bg-white/10 px-4 py-3 text-left text-sm text-white active:bg-white/20 transition-colors"
                >
                  <span className="font-medium">Pocket Mode</span>
                  <span className="ml-2 text-white/40">Blackout screen</span>
                </button>
                <button
                  type="button"
                  onClick={() => { if (!modalDidScroll.current) { setSettingsOpen(false); handleDisconnect(); } }}
                  onTouchEnd={(e) => { e.stopPropagation(); }}
                  className="w-full rounded-2xl bg-red-600/20 px-4 py-3 text-left text-sm text-red-400 active:bg-red-600/40 transition-colors border border-red-600/30"
                >
                  <span className="font-medium">Disconnect</span>
                </button>
              </div>

              {/* Cheat sheet */}
              <div className="rounded-2xl bg-white/5 px-4 py-3">
                <p className="text-xs text-white/40 uppercase tracking-wider mb-3">Gestures & Commands</p>
                <div className="flex flex-col gap-2.5">
                  {[
                    { label: "Zoom", hint: "Hold (in) · Pinch (out)" },
                    { label: "Trackpad", hint: "Double-tap select · Hold & drag highlight" },
                    { label: "Keyboard", hint: "⌨ button — type or paste to PC" },
                    { label: "Dictate", hint: "Double-tap comms button" },
                    { label: "Commands", hint: "Hold comms · tap a slice" },
                  ].map(({ label, hint }) => (
                    <div key={label} className="flex items-baseline gap-2">
                      <span className="min-w-[76px] text-xs font-semibold text-white/70">{label}</span>
                      <span className="text-xs text-white/40">{hint}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Manage subscription */}
              <button
                type="button"
                onClick={() => { setSettingsOpen(false); router.push("/settings"); }}
                onTouchEnd={(e) => { e.stopPropagation(); if (!modalDidScroll.current) { setSettingsOpen(false); router.push("/settings"); } }}
                className="w-full rounded-2xl bg-white/5 px-4 py-3 text-left text-sm text-white/50 active:bg-white/10 transition-colors flex items-center"
              >
                <span className="font-medium">Manage Subscription</span>
                <span className="ml-2 text-white/30">Plan, billing, cancel</span>
                <svg className="ml-auto flex-shrink-0 text-white/30" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
                </svg>
              </button>
            </div>
          </div>
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

      {/* ── Extraction (Copy) toast — both modes ─────────────────────────── */}
      {extractionToast && (
        <>
          {/* Invisible fullscreen overlay — tap outside = dismiss */}
          <div
            className="absolute inset-0 z-20"
            onTouchEnd={(e) => { e.stopPropagation(); }}
            onClick={() => dismissToast()}
          />
          {/* Copy toast — trackpad: straddles border, voice: below paste button */}
          <div
            className={`absolute z-30 flex flex-col gap-2 ${
              mode !== "trackpad"
                ? isLandscape
                  ? "top-[8.5rem] left-4"
                  : "top-16 right-4"
                : ""
            }`}
            style={mode === "trackpad" ? copyToastPosition : undefined}
          >
            <button
              type="button"
              onTouchEnd={(e) => { e.stopPropagation(); }}
              onClick={handleCopy}
              disabled={copiedConfirm}
              className={`rounded-2xl px-6 py-3 text-sm font-semibold shadow-xl transition-all duration-300 ${
                copiedConfirm
                  ? "bg-green-500 text-white scale-95 opacity-0"
                  : "bg-white text-black active:scale-95"
              }`}
              style={{ minWidth: 100, minHeight: 48 }}
            >
              {copiedConfirm ? "✓" : fetchedText ? "Copy" : "..."}
            </button>
            {/* Select All — voice mode only, below Copy */}
            {mode !== "trackpad" && !copiedConfirm && (
              <button
                type="button"
                onTouchEnd={(e) => { e.stopPropagation(); }}
                onClick={handleSelectAll}
                className="rounded-2xl bg-white/80 px-6 py-3 text-sm font-medium text-black shadow-lg backdrop-blur active:scale-95"
                style={{ minWidth: 100, minHeight: 48 }}
              >
                Select All
              </button>
            )}
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

      {/* ── Keyboard overlay — always mounted, hidden via CSS when closed ────── */}
      <KeyboardOverlay
        isOpen={isKeyboardOpen}
        isLandscape={isLandscape}
        textareaRef={keyboardTextareaRef}
        onClose={() => setIsKeyboardOpen(false)}
        sendCommand={sendCommand}
        isConnected={transportStatus === "connected"}
      />

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
              // Single tap — remind the user how to wake up
              setPocketToast(true);
              setTimeout(() => setPocketToast(false), 2000);
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
                onTouchStart={(e) => { e.stopPropagation(); e.preventDefault(); }}
                onTouchEnd={(e) => {
                  e.stopPropagation();
                  e.preventDefault(); // blocks synthetic click from reaching layer underneath
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
      {/* ── Mic Error Toast ──────────────────────────────────────────────────── */}
      <MicErrorToast />
      {/* ── Auto-Pocket Mode Warning Toast ──────────────────────────────────── */}
      {showPocketWarning && (
        <div className="fixed bottom-24 left-1/2 z-[5000] animate-pocket-warning" style={{ transform: "translateX(-50%)" }}>
          <div className="bg-neutral-900/90 backdrop-blur-md text-white px-5 py-3 rounded-full shadow-2xl border border-neutral-700/50 flex items-center gap-3">
            <span className="text-xl">🔋</span>
            <p className="text-sm font-medium tracking-wide">
              Battery saving starts in 10s... <span className="opacity-70 font-normal">Tap to cancel</span>
            </p>
          </div>
        </div>
      )}

    </main>
  );
}

// ─── Mic Error Toast (auto-dismiss) ──────────────────────────────────────────

function MicErrorToast() {
  const micError = useVoiceStore((s) => s.micError);
  const setMicError = useVoiceStore((s) => s.setMicError);

  useEffect(() => {
    if (!micError) return;
    const t = setTimeout(() => setMicError(null), 3000);
    return () => clearTimeout(t);
  }, [micError, setMicError]);

  if (!micError) return null;

  return (
    <div
      className="fixed top-16 left-1/2 z-[6000] -translate-x-1/2 animate-[fadeIn_0.2s_ease-out]"
      onTouchEnd={() => setMicError(null)}
      onClick={() => setMicError(null)}
    >
      <div className="bg-red-500/90 backdrop-blur-md text-white px-5 py-3 rounded-full shadow-2xl flex items-center gap-2">
        <span className="text-base">🎙️</span>
        <p className="text-sm font-medium">{micError}</p>
      </div>
    </div>
  );
}
