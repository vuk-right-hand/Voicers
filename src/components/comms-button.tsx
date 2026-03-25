"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useVoiceStore, useVoice, unlockAudioContext } from "@/hooks/use-voice";
import {
  COMMS_HOLD_MS,
  COMMS_DOUBLE_TAP_MS,
  WHEEL_COMMANDS,
  WHEEL_DEADZONE_RADIUS,
  WHEEL_RADIUS,
} from "@/lib/constants";

interface CommsButtonProps {
  dataChannel: RTCDataChannel | null;
  sendCommand: (cmd: { type: "command"; action: string; payload: Record<string, unknown> }) => void;
}

export function CommsButton({ dataChannel, sendCommand }: CommsButtonProps) {
  const { startListening, stopListening, acceptDictation, cancelDictation } =
    useVoice({ dataChannel });

  const status = useVoiceStore((s) => s.status);
  const mode = useVoiceStore((s) => s.mode);
  const interimText = useVoiceStore((s) => s.interimText);
  const transcript = useVoiceStore((s) => s.transcript);

  // ─── Gesture state ──────────────────────────────────────────────────────
  const [showWheel, setShowWheel] = useState(false);
  const [showDictation, setShowDictation] = useState(false);
  const [activeSlice, setActiveSlice] = useState<number | null>(null);
  const [wheelVoiceDetected, setWheelVoiceDetected] = useState(false);

  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTapTime = useRef(0);
  const isHolding = useRef(false);
  const buttonRef = useRef<HTMLDivElement>(null);
  const buttonCenter = useRef({ x: 0, y: 0 });

  // ─── Double-tap / Hold detection on Comms Button ───────────────────────

  const onButtonTouchStart = useCallback(
    (e: React.TouchEvent) => {
      e.stopPropagation();
      isHolding.current = false;

      // Compute button center for wheel positioning
      if (buttonRef.current) {
        const rect = buttonRef.current.getBoundingClientRect();
        buttonCenter.current = {
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
        };
      }

      // Unlock audio on first ever interaction
      unlockAudioContext();

      // Start hold timer for command wheel
      holdTimer.current = setTimeout(() => {
        isHolding.current = true;
        setShowWheel(true);
        setWheelVoiceDetected(false);
        // Try to start listening in command mode for voice-on-wheel
        // (fails gracefully if no mic / insecure context)
        startListening("command").catch(() => {});
      }, COMMS_HOLD_MS);
    },
    [startListening],
  );

  const onButtonTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      e.stopPropagation();

      // Clear hold timer
      if (holdTimer.current) {
        clearTimeout(holdTimer.current);
        holdTimer.current = null;
      }

      if (isHolding.current) {
        // ── Wheel release ────────────────────────────────────────────
        isHolding.current = false;

        if (wheelVoiceDetected) {
          // Voice detected during hold → stop listening, let host process
          stopListening();
          setShowWheel(false);
          setActiveSlice(null);
          return;
        }

        // Stop mic
        stopListening();

        if (activeSlice !== null) {
          // Drag-to-slice: execute and close
          const cmd = WHEEL_COMMANDS[activeSlice];
          sendCommand({
            type: "command",
            action: cmd.action,
            payload: { ...cmd.payload },
          });
          useVoiceStore.getState().reset();
          setShowWheel(false);
          setActiveSlice(null);
        }
        // activeSlice === null → wheel stays open for tap-to-pick mode
        return;
      }

      // ── Double-tap detection ─────────────────────────────────────────
      const now = Date.now();
      if (now - lastTapTime.current < COMMS_DOUBLE_TAP_MS) {
        // Double-tap!
        lastTapTime.current = 0;

        if (showDictation) {
          // Second double-tap while dictation open → accept
          const fullText = (transcript + (interimText ? " " + interimText : "")).trim();
          if (fullText) {
            stopListening();
            acceptDictation(fullText);
          }
          setShowDictation(false);
        } else if (status === "listening") {
          // Already listening → stop
          stopListening();
        } else {
          // Start dictation
          setShowDictation(true);
          startListening("dictation");
        }
      } else {
        lastTapTime.current = now;
      }
    },
    [
      activeSlice,
      wheelVoiceDetected,
      showDictation,
      status,
      transcript,
      interimText,
      startListening,
      stopListening,
      acceptDictation,
      cancelDictation,
      sendCommand,
    ],
  );

  // ─── Wheel: track thumb position to highlight slices ────────────────────

  const onWheelTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!showWheel) return;
      e.stopPropagation();

      const touch = e.touches[0];
      const dx = touch.clientX - buttonCenter.current.x;
      const dy = touch.clientY - buttonCenter.current.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < WHEEL_DEADZONE_RADIUS) {
        setActiveSlice(null);
        return;
      }

      // atan2 gives angle from positive X axis. We need to map to our
      // top-facing semicircle: slices span from PI (left) to 0 (right),
      // i.e. the upper half. Angle = atan2(-dy, dx) flips Y so "up" is positive.
      const angle = Math.atan2(-dy, dx); // 0 = right, PI = left, negative = below

      // Only activate if thumb is in the upper half (angle > 0)
      if (angle <= 0) {
        setActiveSlice(null);
        return;
      }

      // Map angle PI→0 to slice index 0→(N-1)
      // angle=PI is leftmost (slice 0), angle=0 is rightmost (slice N-1)
      const sliceAngle = Math.PI / WHEEL_COMMANDS.length;
      const sliceIndex = Math.floor((Math.PI - angle) / sliceAngle);
      setActiveSlice(Math.min(sliceIndex, WHEEL_COMMANDS.length - 1));
    },
    [showWheel],
  );

  // Fallback dismiss / drag-from-open-wheel: release on overlay background
  const onWheelOverlayTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      e.stopPropagation();
      if (!showWheel) return;
      isHolding.current = false;
      stopListening();
      if (activeSlice !== null) {
        // Drag that started on overlay ended over a highlighted slice — execute
        const cmd = WHEEL_COMMANDS[activeSlice];
        sendCommand({ type: "command", action: cmd.action, payload: { ...cmd.payload } });
        useVoiceStore.getState().reset();
      } else {
        cancelDictation();
      }
      setShowWheel(false);
      setActiveSlice(null);
    },
    [showWheel, activeSlice, stopListening, cancelDictation, sendCommand],
  );

  // Listen for voice detection during wheel (interim STT means voice detected)
  useEffect(() => {
    if (showWheel && interimText) {
      setWheelVoiceDetected(true);
    }
  }, [showWheel, interimText]);

  // Close dictation when processing finishes and goes back to idle
  useEffect(() => {
    if (status === "idle" && mode === null && showDictation) {
      setShowDictation(false);
    }
  }, [status, mode, showDictation]);

  // ─── Dictation Modal handlers ──────────────────────────────────────────

  const handleAccept = useCallback(() => {
    const fullText = (transcript + (interimText ? " " + interimText : "")).trim();
    if (fullText) {
      stopListening();
      acceptDictation(fullText);
    }
    setShowDictation(false);
  }, [transcript, interimText, stopListening, acceptDictation]);

  const handleCancel = useCallback(() => {
    stopListening();
    cancelDictation();
    setShowDictation(false);
  }, [stopListening, cancelDictation]);

  // ─── Render ────────────────────────────────────────────────────────────

  const displayText = (transcript + (interimText ? " " + interimText : "")).trim();

  return (
    <>
      {/* ── Command Wheel Overlay ─────────────────────────────────────── */}
      {showWheel && (
        <div
          className="fixed inset-0 z-50"
          style={{ backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)" }}
          onTouchMove={onWheelTouchMove}
          onTouchEnd={onWheelOverlayTouchEnd}
        >
          {/* Wheel center anchored at button center */}
          <div
            className="absolute"
            style={{
              left: buttonCenter.current.x,
              top: buttonCenter.current.y,
            }}
          >
            {/* Slices — top-facing semicircle (arch above button) */}
            {WHEEL_COMMANDS.map((cmd, i) => {
              // Spread evenly across PI→0 (left to right, upper half)
              const angle =
                Math.PI - ((i + 0.5) * Math.PI) / WHEEL_COMMANDS.length;
              const x = Math.cos(angle) * WHEEL_RADIUS;
              const y = -Math.sin(angle) * WHEEL_RADIUS; // negative = upward
              const isActive = activeSlice === i;

              return (
                <div
                  key={cmd.label}
                  className={`absolute flex items-center justify-center rounded-full transition-all duration-150 ${
                    isActive
                      ? "bg-white text-black scale-110"
                      : "bg-white/15 text-white"
                  }`}
                  style={{
                    width: 72,
                    height: 72,
                    left: x - 36,
                    top: y - 36,
                    backdropFilter: isActive ? undefined : "blur(4px)",
                  }}
                  onTouchStart={(e) => { e.stopPropagation(); setActiveSlice(i); }}
                  onTouchEnd={(e) => {
                    e.stopPropagation();
                    sendCommand({ type: "command", action: cmd.action, payload: { ...cmd.payload } });
                    useVoiceStore.getState().reset();
                    stopListening();
                    setShowWheel(false);
                    setActiveSlice(null);
                  }}
                >
                  <div className="flex flex-col items-center leading-tight">
                    <span className="text-xs font-bold">{cmd.label}</span>
                    <span className={`text-[10px] ${isActive ? "text-black/60" : "text-white/50"}`}>
                      {cmd.sub}
                    </span>
                  </div>
                </div>
              );
            })}

            {/* Center indicator */}
            <div
              className={`absolute rounded-full border-2 ${
                wheelVoiceDetected
                  ? "border-green-400 bg-green-400/20"
                  : "border-white/30 bg-white/5"
              }`}
              style={{
                width: WHEEL_DEADZONE_RADIUS * 2,
                height: WHEEL_DEADZONE_RADIUS * 2,
                left: -WHEEL_DEADZONE_RADIUS,
                top: -WHEEL_DEADZONE_RADIUS,
              }}
            >
              {wheelVoiceDetected && (
                <div className="flex h-full items-center justify-center">
                  <span className="text-xs text-green-400">Voice</span>
                </div>
              )}
            </div>
          </div>

          {/* Voice transcript during wheel */}
          {wheelVoiceDetected && interimText && (
            <div className="absolute inset-x-0 top-1/3 flex justify-center px-6">
              <p className="rounded-2xl bg-black/60 px-4 py-2 text-center text-lg text-white backdrop-blur">
                {interimText}
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── Dictation Modal (Bottom Sheet) ────────────────────────────── */}
      {showDictation && (
        <div className="fixed inset-x-0 bottom-0 z-40 flex flex-col bg-zinc-900/95 backdrop-blur-xl"
          style={{
            maxHeight: "50dvh",
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
          }}
          onTouchStart={(e) => e.stopPropagation()}
          onTouchMove={(e) => e.stopPropagation()}
          onTouchEnd={(e) => e.stopPropagation()}
        >
          {/* Handle */}
          <div className="flex justify-center pt-3 pb-2 flex-shrink-0">
            <div className="h-1 w-10 rounded-full bg-white/20" />
          </div>

          {/* Status */}
          <div className="flex items-center gap-2 px-5 pb-2 flex-shrink-0">
            {status === "listening" && (
              <>
                <span className="h-2.5 w-2.5 rounded-full bg-red-500 animate-pulse" />
                <span className="text-sm text-white/60">Listening...</span>
              </>
            )}
            {status === "processing" && (
              <span className="text-sm text-white/60">Processing...</span>
            )}
          </div>

          {/* Transcript */}
          <div className="flex-1 min-h-0 overflow-y-auto px-5 pb-4">
            <p className="text-xl leading-relaxed text-white">
              {displayText || (
                <span className="text-white/30">Start speaking...</span>
              )}
            </p>
          </div>

          {/* Actions — flex-shrink-0 so buttons never get pushed off-screen */}
          <div className="flex gap-3 px-5 pb-6 pt-2 flex-shrink-0">
            <button
              type="button"
              className="flex-1 rounded-xl bg-white/10 py-3 text-sm font-medium text-white/70 active:bg-white/20"
              onClick={handleCancel}
            >
              Cancel
            </button>
            <button
              type="button"
              className="flex-1 rounded-xl bg-white py-3 text-sm font-medium text-black active:bg-white/90"
              onClick={handleAccept}
              disabled={!displayText}
            >
              Accept
            </button>
          </div>
        </div>
      )}

      {/* ── Comms FAB ─────────────────────────────────────────────────── */}
      <div
        ref={buttonRef}
        className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2"
        onTouchStart={onButtonTouchStart}
        onTouchEnd={onButtonTouchEnd}
        onTouchMove={onWheelTouchMove}
      >
        <button
          type="button"
          className={`flex h-16 w-16 items-center justify-center rounded-full shadow-lg transition-all duration-200 ${
            showWheel
              ? "bg-white/15 backdrop-blur shadow-white/10"
              : status === "listening"
                ? "bg-red-500 shadow-red-500/30"
                : status === "processing"
                  ? "bg-amber-500 shadow-amber-500/30"
                  : status === "speaking"
                    ? "bg-blue-500 shadow-blue-500/30"
                    : "bg-white/15 backdrop-blur shadow-white/10"
          }`}
          style={{ touchAction: "none" }}
        >
          {/* Mic icon */}
          {status === "idle" && (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="22" />
            </svg>
          )}

          {/* Listening — pulse ring (suppressed during wheel: use center indicator instead) */}
          {status === "listening" && (
            <>
              {!showWheel && <span className="absolute inset-0 rounded-full border-2 border-red-400 animate-ping opacity-30" />}
              <svg width="24" height="24" viewBox="0 0 24 24" fill="white" stroke="none">
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
              </svg>
            </>
          )}

          {/* Processing — spinner */}
          {status === "processing" && (
            <svg width="24" height="24" viewBox="0 0 24 24" className="animate-spin">
              <circle cx="12" cy="12" r="10" stroke="white" strokeWidth="2" fill="none" strokeDasharray="31.4 31.4" strokeLinecap="round" />
            </svg>
          )}

          {/* Speaking — speaker icon */}
          {status === "speaking" && (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
            </svg>
          )}
        </button>
      </div>
    </>
  );
}
