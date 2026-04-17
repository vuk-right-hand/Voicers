"use client";

import { useEffect, useRef, useState } from "react";
import type { PhoneCommand } from "@/types";

interface KeyboardOverlayProps {
  isOpen: boolean;
  isLandscape: boolean;
  onClose: () => void;
  sendCommand: (cmd: PhoneCommand) => void;
  isConnected: boolean;
}

type KbMode = "letters" | "numbers" | "symbols";

const LETTER_ROWS = [
  ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
  ["a", "s", "d", "f", "g", "h", "j", "k", "l"],
  ["z", "x", "c", "v", "b", "n", "m"],
];

const NUMBER_ROWS = [
  ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
  ["-", "/", ":", ";", "(", ")", "$", "&", "@", "\""],
  [".", ",", "?", "!", "'"],
];

const SYMBOL_ROWS = [
  ["[", "]", "{", "}", "#", "%", "^", "*", "+", "="],
  ["_", "\\", "|", "~", "<", ">", "€", "£", "¥", "`"],
  [".", ",", "?", "!", "'"],
];

export function KeyboardOverlay({
  isOpen,
  isLandscape,
  onClose,
  sendCommand,
  isConnected,
}: KeyboardOverlayProps) {
  const [mode, setMode] = useState<KbMode>("letters");
  const [shift, setShift] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const lastShiftTap = useRef(0);

  // Landscape panel drag (position) and resize (width) — kept for compat.
  // Landscape auto-closes the overlay in the parent, so these are dormant.
  const [panelWidth, setPanelWidth] = useState(400);
  const [panelRight, setPanelRight] = useState(0);
  const dragStartX = useRef(0);
  const dragStartRight = useRef(0);
  const resizeStartX = useRef(0);
  const resizeStartWidth = useRef(400);

  // Reset volatile state when the sheet closes
  useEffect(() => {
    if (!isOpen) {
      setShift(false);
      setCapsLock(false);
      setMode("letters");
    }
  }, [isOpen]);

  const sendChar = (ch: string) => {
    if (!isConnected) return;
    sendCommand({ type: "type", text: ch });
  };

  const handleLetter = (letter: string) => {
    const upper = capsLock || shift;
    sendChar(upper ? letter.toUpperCase() : letter);
    if (shift && !capsLock) setShift(false);
  };

  const handleShift = () => {
    const now = Date.now();
    // Double-tap within 300ms → toggle caps lock
    if (now - lastShiftTap.current < 300) {
      setCapsLock((c) => !c);
      setShift(false);
    } else if (capsLock) {
      setCapsLock(false);
      setShift(false);
    } else {
      setShift((s) => !s);
    }
    lastShiftTap.current = now;
  };

  const handleBackspace = () => {
    if (!isConnected) return;
    sendCommand({ type: "command", action: "shortcut", payload: { keys: ["backspace"] } });
  };

  const handleReturn = () => {
    if (!isConnected) return;
    sendCommand({ type: "command", action: "shortcut", payload: { keys: ["enter"] } });
  };

  const handlePaste = async (e: React.TouchEvent | React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      const clip = await navigator.clipboard.readText();
      if (clip) sendCommand({ type: "type-text", text: clip });
    } catch {
      // blocked
    }
  };

  // ── Landscape handlers (dormant but preserved) ─────────────────────────────
  const onDragStart = (e: React.TouchEvent) => {
    e.stopPropagation();
    dragStartX.current = e.touches[0].clientX;
    dragStartRight.current = panelRight;
  };
  const onDragMove = (e: React.TouchEvent) => {
    e.stopPropagation();
    const dx = e.touches[0].clientX - dragStartX.current;
    setPanelRight(Math.max(0, Math.min(window.innerWidth - panelWidth - 20, dragStartRight.current - dx)));
  };
  const onResizeStart = (e: React.TouchEvent) => {
    e.stopPropagation();
    resizeStartX.current = e.touches[0].clientX;
    resizeStartWidth.current = panelWidth;
  };
  const onResizeMove = (e: React.TouchEvent) => {
    e.stopPropagation();
    const dx = e.touches[0].clientX - resizeStartX.current;
    setPanelWidth(Math.max(250, Math.min(Math.floor(window.innerWidth * 0.8), resizeStartWidth.current - dx)));
  };

  const slideOut = isLandscape ? "translateX(calc(100% + 40px))" : "translateY(calc(100% + 40px))";

  const panelStyle: React.CSSProperties = isLandscape
    ? {
        position: "fixed",
        top: 0,
        right: panelRight,
        width: panelWidth,
        height: "100%",
        zIndex: 9990,
        borderRadius: "16px 0 0 16px",
        transform: isOpen ? "translate(0)" : slideOut,
        transition: "transform 250ms ease-out",
      }
    : {
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))",
        zIndex: 9990,
        borderRadius: "20px 20px 0 0",
        transform: isOpen ? "translate(0)" : slideOut,
        transition: "transform 250ms ease-out",
      };

  const rows = mode === "letters" ? LETTER_ROWS : mode === "numbers" ? NUMBER_ROWS : SYMBOL_ROWS;

  // Character key (tall, prominent)
  const charKeyCls =
    "min-w-0 rounded-md flex items-center justify-center text-lg font-medium shadow-sm active:bg-white/30 transition-colors select-none bg-white/15 text-white";
  // Modifier / function key (smaller text, slightly muted)
  const modKeyCls =
    "min-w-0 rounded-md flex items-center justify-center text-xs font-semibold shadow-sm active:bg-white/30 transition-colors select-none bg-white/10 text-white/90 uppercase tracking-wide";

  const keyHeight = { height: "46px" };

  const shiftLabel = capsLock ? "⇪" : "⇧";
  const shiftActive = shift || capsLock;

  return (
    <div
      className="flex flex-col bg-zinc-900 border border-white/10 shadow-2xl"
      style={panelStyle}
      onTouchStart={(e) => e.stopPropagation()}
      onTouchMove={(e) => e.stopPropagation()}
      onTouchEnd={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {isLandscape && (
        <div
          className="absolute left-0 top-0 bottom-0 w-5 flex items-center justify-center z-10 touch-none"
          style={{ cursor: "ew-resize" }}
          onTouchStart={onResizeStart}
          onTouchMove={onResizeMove}
          onTouchEnd={(e) => e.stopPropagation()}
        >
          <div className="w-1 h-8 rounded-full bg-white/20" />
        </div>
      )}

      {/* Header: paste + close */}
      <div
        className="relative flex-shrink-0 flex items-center gap-3 px-3 pt-4 pb-2"
        onTouchStart={isLandscape ? onDragStart : undefined}
        onTouchMove={isLandscape ? onDragMove : undefined}
        onTouchEnd={(e) => e.stopPropagation()}
      >
        {!isLandscape && (
          <div className="absolute top-1.5 left-1/2 -translate-x-1/2 w-10 h-1 rounded-full bg-white/20" />
        )}

        <button
          type="button"
          onTouchEnd={handlePaste}
          onClick={handlePaste}
          className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold text-white/80 active:bg-white/20"
        >
          📋 Paste
        </button>

        <button
          type="button"
          className="ml-auto flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-white/10 text-white/60 active:bg-white/20 transition-colors"
          onTouchEnd={(e) => { e.stopPropagation(); onClose(); }}
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          aria-label="Close keyboard"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Keyboard grid */}
      <div className="flex-1 flex flex-col gap-1.5 px-1.5 pb-1.5 pt-1 select-none touch-none">
        {rows.map((row, rIdx) => {
          const isLastCharRow = rIdx === 2;
          // Middle letters row (asdf…) is inset by half a key on each side for iOS look
          const needsInset = mode === "letters" && rIdx === 1;

          return (
            <div key={rIdx} className="flex gap-1 w-full items-stretch">
              {needsInset && <div style={{ flex: 0.5 }} />}

              {/* Last char row starts with shift or mode-toggle */}
              {isLastCharRow && (
                <button
                  type="button"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (mode === "letters") handleShift();
                    else setMode(mode === "numbers" ? "symbols" : "numbers");
                  }}
                  onContextMenu={(e) => e.preventDefault()}
                  className={`${modKeyCls} ${mode === "letters" && shiftActive ? "!bg-white !text-black" : ""}`}
                  style={{ ...keyHeight, flex: 1.5 }}
                >
                  {mode === "letters" ? shiftLabel : mode === "numbers" ? "#+=" : "123"}
                </button>
              )}

              {row.map((key) => {
                const displayChar =
                  mode === "letters" && (capsLock || shift) ? key.toUpperCase() : key;
                return (
                  <button
                    key={key}
                    type="button"
                    onPointerDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (mode === "letters") handleLetter(key);
                      else sendChar(key);
                    }}
                    onContextMenu={(e) => e.preventDefault()}
                    className={charKeyCls}
                    style={{ ...keyHeight, flex: 1 }}
                  >
                    {displayChar}
                  </button>
                );
              })}

              {/* Last char row ends with backspace */}
              {isLastCharRow && (
                <button
                  type="button"
                  onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); handleBackspace(); }}
                  onContextMenu={(e) => e.preventDefault()}
                  className={modKeyCls}
                  style={{ ...keyHeight, flex: 1.5 }}
                  aria-label="Backspace"
                >
                  ⌫
                </button>
              )}

              {needsInset && <div style={{ flex: 0.5 }} />}
            </div>
          );
        })}

        {/* Bottom row: mode-toggle, space, return */}
        <div className="flex gap-1 w-full items-stretch">
          <button
            type="button"
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setShift(false);
              setCapsLock(false);
              setMode(mode === "letters" ? "numbers" : "letters");
            }}
            onContextMenu={(e) => e.preventDefault()}
            className={modKeyCls}
            style={{ ...keyHeight, flex: 1.8 }}
          >
            {mode === "letters" ? "123" : "ABC"}
          </button>
          <button
            type="button"
            onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); sendChar(" "); }}
            onContextMenu={(e) => e.preventDefault()}
            className={`${charKeyCls} !text-sm !font-normal`}
            style={{ ...keyHeight, flex: 5 }}
            aria-label="Space"
          >
            space
          </button>
          <button
            type="button"
            onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); handleReturn(); }}
            onContextMenu={(e) => e.preventDefault()}
            className={modKeyCls}
            style={{ ...keyHeight, flex: 1.8 }}
          >
            return
          </button>
        </div>
      </div>
    </div>
  );
}
