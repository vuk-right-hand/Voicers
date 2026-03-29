"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PhoneCommand } from "@/types";

interface KeyboardOverlayProps {
  isOpen: boolean;
  isLandscape: boolean;
  /** Ref owned by the parent — focus() is called synchronously in the toggle button's
   *  onClick handler BEFORE setIsKeyboardOpen(true) to bypass iOS async-focus block. */
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  onClose: () => void;
  sendCommand: (cmd: PhoneCommand) => void;
  isConnected: boolean;
}

export function KeyboardOverlay({
  isOpen,
  isLandscape,
  textareaRef,
  onClose,
  sendCommand,
  isConnected,
}: KeyboardOverlayProps) {
  const [text, setText] = useState("");

  // visualViewport tracks the region NOT covered by the native keyboard.
  // keyboardHeight = how far to push the panel up from the bottom.
  // availableHeight = height of the visible region above the native keyboard.
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [availableHeight, setAvailableHeight] = useState(
    typeof window !== "undefined" ? window.innerHeight : 812,
  );

  // Landscape panel drag (position) and resize (width)
  const [panelWidth, setPanelWidth] = useState(280);
  const [panelRight, setPanelRight] = useState(0);
  const dragStartX = useRef(0);
  const dragStartRight = useRef(0);
  const resizeStartX = useRef(0);
  const resizeStartWidth = useRef(280);

  // ── visualViewport listener ─────────────────────────────────────────────────
  // Keeps the overlay pinned above the native keyboard as it rises/falls.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      // keyboard height = layout viewport bottom minus visual viewport bottom
      const kbH = Math.max(0, window.innerHeight - vv.offsetTop - vv.height);
      setKeyboardHeight(kbH);
      setAvailableHeight(vv.height);
    };
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    update();
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  // Clear text when panel closes so next open starts fresh
  useEffect(() => {
    if (!isOpen) setText("");
  }, [isOpen]);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || !isConnected) return;
    sendCommand({ type: "type-text", text: trimmed });
    setText("");
    onClose();
  }, [text, isConnected, sendCommand, onClose]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Plain Enter = newline (multi-line support for code snippets).
    // Ctrl+Enter or Cmd+Enter = send.
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      handleSend();
    }
  };

  const handlePaste = async () => {
    try {
      const clip = await navigator.clipboard.readText();
      if (clip) setText((prev) => prev + clip);
    } catch {
      // Clipboard read blocked (permission denied or nothing copied) — silent
    }
  };

  // ── Landscape: drag handle on header bar (move panel left/right) ────────────
  const onDragStart = (e: React.TouchEvent) => {
    e.stopPropagation();
    dragStartX.current = e.touches[0].clientX;
    dragStartRight.current = panelRight;
  };
  const onDragMove = (e: React.TouchEvent) => {
    e.stopPropagation();
    const dx = e.touches[0].clientX - dragStartX.current;
    // Moving finger left → dx negative → panelRight increases (panel moves left)
    setPanelRight(
      Math.max(0, Math.min(window.innerWidth - panelWidth - 20, dragStartRight.current - dx)),
    );
  };

  // ── Landscape: resize handle on left edge ───────────────────────────────────
  const onResizeStart = (e: React.TouchEvent) => {
    e.stopPropagation();
    resizeStartX.current = e.touches[0].clientX;
    resizeStartWidth.current = panelWidth;
  };
  const onResizeMove = (e: React.TouchEvent) => {
    e.stopPropagation();
    const dx = e.touches[0].clientX - resizeStartX.current;
    // Moving finger left → dx negative → panel gets wider
    setPanelWidth(
      Math.max(200, Math.min(Math.floor(window.innerWidth * 0.65), resizeStartWidth.current - dx)),
    );
  };

  // ── Panel positioning ───────────────────────────────────────────────────────
  const slideOut = isLandscape ? "translateX(calc(100% + 40px))" : "translateY(calc(100% + 40px))";

  const panelStyle: React.CSSProperties = isLandscape
    ? {
        position: "fixed",
        top: 0,
        right: panelRight,
        width: panelWidth,
        height: availableHeight,
        zIndex: 9990,
        borderRadius: "16px 0 0 16px",
        transform: isOpen ? "translate(0)" : slideOut,
        transition: "transform 250ms ease-out",
      }
    : {
        position: "fixed",
        left: 0,
        right: 0,
        bottom: keyboardHeight,
        height: Math.min(Math.max(Math.floor(availableHeight * 0.45), 180), 320),
        zIndex: 9990,
        borderRadius: "20px 20px 0 0",
        transform: isOpen ? "translate(0)" : slideOut,
        transition: "transform 250ms ease-out",
      };

  return (
    <>
      {/* Backdrop — portrait only. Covers the video feed to swallow touches and
          prevent accidental PC taps while the keyboard overlay is open. */}
      {!isLandscape && (
        <div
          className="fixed inset-0 z-[9989]"
          style={{
            pointerEvents: isOpen ? "auto" : "none",
            opacity: isOpen ? 1 : 0,
            transition: "opacity 250ms ease-out",
            backgroundColor: "rgba(0,0,0,0.45)",
          }}
          onTouchStart={(e) => e.stopPropagation()}
          onTouchMove={(e) => e.stopPropagation()}
          onTouchEnd={(e) => { e.stopPropagation(); onClose(); }}
          onClick={onClose}
        />
      )}

      {/* Panel — always mounted so textareaRef is always a valid DOM node.
          iOS requires a pre-existing focused element; the parent calls
          textareaRef.current.focus() synchronously in the button's onClick
          BEFORE calling setIsKeyboardOpen(true). */}
      <div
        className="flex flex-col bg-zinc-900 border border-white/10 shadow-2xl"
        style={panelStyle}
        onTouchStart={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
        onTouchEnd={(e) => e.stopPropagation()}
      >
        {/* ── Landscape: left-edge resize handle ──────────────────────────── */}
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

        {/* ── Header ────────────────────────────────────────────────────────── */}
        <div
          className="flex-shrink-0 flex items-center gap-3 px-4 pt-3 pb-2"
          onTouchStart={isLandscape ? onDragStart : undefined}
          onTouchMove={isLandscape ? onDragMove : undefined}
          onTouchEnd={(e) => e.stopPropagation()}
        >
          {/* Portrait: center drag pill */}
          {!isLandscape && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 w-10 h-1 rounded-full bg-white/20" />
          )}

          <span className="text-xs font-semibold text-white/40 tracking-wider select-none">
            {isLandscape ? "⌨ KEYBOARD — drag header to move" : "⌨ KEYBOARD"}
          </span>

          <button
            type="button"
            className="ml-auto flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-white/10 text-white/60 active:bg-white/20 transition-colors"
            onTouchEnd={(e) => { e.stopPropagation(); onClose(); }}
            onClick={onClose}
            aria-label="Close keyboard"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* ── Textarea ──────────────────────────────────────────────────────── */}
        {/* MAX_CHARS: WebRTC data channel SCTP limit is typically ~256KB, but
            the JSON envelope + network stack add overhead. 16 000 chars (~16KB)
            is a safe ceiling that covers any realistic code snippet. */}
        <div className="relative flex-1 px-4 pb-1 min-h-0">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type or paste text to send to your PC…"
            maxLength={16000}
            className="w-full h-full resize-none rounded-xl bg-white/5 text-white placeholder-white/25 px-3 py-2.5 focus:outline-none focus:ring-1 focus:ring-white/20"
            // 16px is MANDATORY — below this iOS auto-zooms the viewport on focus,
            // permanently breaking the spatial UI.
            style={{ fontSize: "16px", lineHeight: "1.5" }}
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
          />
          {/* Warn when approaching the limit */}
          {text.length > 12000 && (
            <span
              className="absolute bottom-3 right-6 text-xs select-none"
              style={{ color: text.length > 15000 ? "#f87171" : "rgba(255,255,255,0.3)" }}
            >
              {text.length}/16000
            </span>
          )}
        </div>

        {/* ── Action row ────────────────────────────────────────────────────── */}
        <div className="flex-shrink-0 flex items-center gap-2 px-4 pb-4">
          <button
            type="button"
            onClick={handlePaste}
            onTouchEnd={(e) => { e.stopPropagation(); handlePaste(); }}
            className="rounded-xl bg-white/10 px-4 py-2.5 text-sm font-medium text-white/70 active:bg-white/20 transition-colors"
          >
            📋 Paste
          </button>
          <div className="flex-1" />
          {text.trim() && (
            <span className="text-xs text-white/25 select-none">⌘↩ to send</span>
          )}
          <button
            type="button"
            onClick={handleSend}
            onTouchEnd={(e) => { e.stopPropagation(); handleSend(); }}
            disabled={!text.trim() || !isConnected}
            className="rounded-xl bg-white px-5 py-2.5 text-sm font-semibold text-black active:scale-95 transition-all disabled:opacity-30 disabled:active:scale-100"
          >
            Send →
          </button>
        </div>
      </div>
    </>
  );
}
