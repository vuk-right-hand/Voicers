"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PhoneCommand } from "@/types";

interface KeyboardOverlayProps {
  isOpen: boolean;
  isLandscape: boolean;
  /** No longer used for real focusing, kept for compat/ref */
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  onClose: () => void;
  sendCommand: (cmd: PhoneCommand) => void;
  isConnected: boolean;
}

const ROWS = [
  ["Esc", "1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "Bksp"],
  ["Tab", "q", "w", "e", "r", "t", "y", "u", "i", "o", "p", "-", "="],
  ["Caps", "a", "s", "d", "f", "g", "h", "j", "k", "l", ";", "'", "Enter"],
  ["Shift", "z", "x", "c", "v", "b", "n", "m", ",", ".", "/", "Up"],
  ["Ctrl", "Cmd", "Alt", "Space", "Left", "Down", "Right"]
];

export function KeyboardOverlay({
  isOpen,
  isLandscape,
  onClose,
  sendCommand,
  isConnected,
}: KeyboardOverlayProps) {
  const [activeModifiers, setActiveModifiers] = useState<Set<string>>(new Set());
  const [capsLock, setCapsLock] = useState(false);
  const [shift, setShift] = useState(false);

  // Landscape panel drag (position) and resize (width)
  const [panelWidth, setPanelWidth] = useState(400); // Ticking up slightly to fit keys
  const [panelRight, setPanelRight] = useState(0);
  const dragStartX = useRef(0);
  const dragStartRight = useRef(0);
  const resizeStartX = useRef(0);
  const resizeStartWidth = useRef(400);

  // Clear states when closed
  useEffect(() => {
    if (!isOpen) {
      setActiveModifiers(new Set());
      setShift(false);
    }
  }, [isOpen]);

  const toggleModifier = (mod: string) => {
    setActiveModifiers(prev => {
      const next = new Set(prev);
      if (next.has(mod)) next.delete(mod);
      else next.add(mod);
      return next;
    });
  };

  const clearModifiers = () => {
    setActiveModifiers(new Set());
    setShift(false);
  };

  const handleKeyPress = useCallback((key: string, e: React.TouchEvent | React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isConnected) return;

    if (key === "Bksp") {
      sendCommand({ type: "command", action: "shortcut", payload: { keys: ["backspace"] } });
    } else if (key === "Enter") {
      sendCommand({ type: "command", action: "shortcut", payload: { keys: ["enter"] } });
    } else if (key === "Space") {
      sendCommand({ type: "type", text: " " });
    } else if (key === "Tab" || key === "Esc" || key === "Up" || key === "Down" || key === "Left" || key === "Right") {
      const map: Record<string, string> = { "Esc": "esc", "Up": "up", "Down": "down", "Left": "left", "Right": "right", "Tab": "tab" };
      sendCommand({ type: "command", action: "shortcut", payload: { keys: [map[key]] } });
    } else if (key === "Shift") {
      setShift(s => !s);
    } else if (key === "Caps") {
      setCapsLock(c => !c);
    } else if (["Ctrl", "Alt", "Cmd"].includes(key)) {
      const map: Record<string, string> = { "Ctrl": "ctrl", "Alt": "alt", "Cmd": "command" };
      toggleModifier(map[key]);
    } else {
      // Normal character
      const isUpper = capsLock !== shift;
      const char = isUpper ? key.toUpperCase() : key;

      if (activeModifiers.size > 0) {
        // e.g., Ctrl + C
        sendCommand({ type: "command", action: "shortcut", payload: { keys: [...Array.from(activeModifiers), char.toLowerCase()] } });
        clearModifiers();
      } else {
        sendCommand({ type: "type", text: char });
        setShift(false); // auto-turn off shift
      }
    }
  }, [isConnected, activeModifiers, capsLock, shift, sendCommand]);

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

  // ── Landscape: drag handle on header bar ────────────
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

  // ── Landscape: resize handle on left edge ───────────
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

  // ── Panel positioning ───────────────────────────────────────────────────────
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
        bottom: 0, // Pinned to real bottom since no native keyboard will push it
        height: "auto",
        minHeight: "45vh", // Give it room for the keypad
        paddingBottom: "max(1rem, env(safe-area-inset-bottom))",
        zIndex: 9990,
        borderRadius: "20px 20px 0 0",
        transform: isOpen ? "translate(0)" : slideOut,
        transition: "transform 250ms ease-out",
      };

  return (
    <>
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

        <div
          className="flex-shrink-0 flex items-center gap-3 px-4 pt-4 pb-2"
          onTouchStart={isLandscape ? onDragStart : undefined}
          onTouchMove={isLandscape ? onDragMove : undefined}
          onTouchEnd={(e) => e.stopPropagation()}
        >
          {!isLandscape && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 w-10 h-1 rounded-full bg-white/20" />
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onTouchEnd={handlePaste}
              onClick={handlePaste}
              className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold text-white/80 active:bg-white/20"
            >
              📋 Paste
            </button>
          </div>

          <span className="ml-auto text-xs font-semibold text-white/40 tracking-wider select-none pr-3">
            HACKER KEYBOARD
          </span>

          <button
            type="button"
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-white/10 text-white/60 active:bg-white/20 transition-colors"
            onTouchEnd={(e) => { e.stopPropagation(); onClose(); }}
            onClick={(e) => { e.stopPropagation(); onClose(); }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* ── Custom Keyboard Grid ── */}
        <div className="flex-1 flex flex-col gap-1.5 px-2 pb-2 pt-2 select-none touch-none">
          {ROWS.map((row, rIdx) => (
            <div key={rIdx} className="flex gap-1 w-full justify-center" style={{ gap: "4px" }}>
              {row.map((key) => {
                // Determine styling and flex-basis based on key type
                const isMod = ["Esc", "Tab", "Caps", "Shift", "Bksp", "Enter", "Ctrl", "Alt", "Cmd"].includes(key);
                const isArrow = ["Up", "Down", "Left", "Right"].includes(key);
                const isSpace = key === "Space";

                // Active states
                const isActiveModifier = activeModifiers.has(key.toLowerCase()) || 
                  (key === "Cmd" && activeModifiers.has("command"));
                const isShiftActive = key === "Shift" && shift;
                const isCapsActive = key === "Caps" && capsLock;
                const isActive = isActiveModifier || isShiftActive || isCapsActive;

                let flexStyle = "flex-1";
                if (isSpace) flexStyle = "flex-[4]";
                else if (isMod) flexStyle = "flex-[1.5]";
                else if (isArrow) flexStyle = "flex-[1.2]";
                
                // Render character with casing
                let displayChar = key;
                if (!isMod && !isArrow && !isSpace && key.length === 1) {
                  displayChar = (capsLock !== shift) ? key.toUpperCase() : key;
                }

                return (
                  <button
                    key={key}
                    type="button"
                    // Use onPointerDown for instant response (faster than onClick/onTouchEnd)
                    onPointerDown={(e) => handleKeyPress(key, e)}
                    className={`${flexStyle} min-w-0 rounded-md py-3 md:py-4 flex items-center justify-center text-sm md:text-base font-medium shadow-sm active:scale-95 active:bg-white/30 transition-all ${
                      isActive ? "bg-white text-black" : "bg-white/10 text-white"
                    } ${isMod || isArrow ? "text-xs px-1" : ""}`}
                    // Prevent context menus on long press
                    onContextMenu={(e) => e.preventDefault()}
                  >
                    {isSpace ? "" : displayChar}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
