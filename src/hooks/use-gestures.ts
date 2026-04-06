"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PhoneCommand } from "@/types";
import {
  SNIPER_ZOOM_HOLD_MS,
  SNIPER_ZOOM_LEVEL,
  SNIPER_ZOOM_LEVEL_2,
  HOLD_SLOP_RADIUS,
  SCROLL_STRIP_SENSITIVITY,
  EDGE_MOMENTUM_ZONE,
  EDGE_MOMENTUM_SPEED,
  TRACKPAD_MOVE_SENSITIVITY,
  TRACKPAD_DOUBLE_TAP_MS,
  TRACKPAD_TAP_MAX_MS,
  TRACKPAD_HOLD_MS,
} from "@/lib/constants";

type GestureState =
  | "idle"
  | "holding"              // voice: hold timer running (< 200ms = tap)
  | "zoomed"               // voice/trackpad-glass: sticky zoom active
  | "zoomed-highlighting"  // voice: hold at max zoom confirmed, mousedown active
  | "strip-scrolling"      // both: 1-finger in scroll zone
  | "pinching"             // both: 2-finger pinch
  | "tp-dragging"          // trackpad: 1-finger drag / pre-tap / pre-hold
  | "tp-highlighting";     // trackpad: hold confirmed, mousedown active, dragging selection

interface ZoomStyle {
  transform?: string;
  transformOrigin?: string;
  transition?: string;
}

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Gesture state machine for the video stream.
 *
 * Voice mode:  quick tap, sticky sniper zoom (hold 200ms), pinch-to-zoom-out,
 *              scroll zone (compact widget).
 * Trackpad mode: constrained to trackpadRect — relative mouse movement,
 *                single tap (click at cursor), double-tap (word select),
 *                hold-to-highlight with edge momentum.
 *                Video area (outside trackpad) gets full voice-mode gestures
 *                (zoom, pan, pinch) but NOT taps or mouse movement.
 */
export function useGestures(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  sendCommand: (cmd: PhoneCommand) => void,
  mode: "voice" | "trackpad",
  screenDims: { width: number; height: number },
  onHighlightEnd: (pcPos: { x: number; y: number }) => void,
  onDoubleClick: (pcPos: { x: number; y: number }) => void,
  scrollRect: Rect | null,
  trackpadRect: Rect | null,
) {
  const [gestureState, setGestureState] = useState<GestureState>("idle");
  const [zoomStyle, setZoomStyle] = useState<ZoomStyle>({});
  const [zoomPercent, setZoomPercent] = useState(0);
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null);

  const stateRef = useRef<GestureState>("idle");
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startPos = useRef({ x: 0, y: 0 });
  const startTime = useRef(0);
  const isInitialHoldTouch = useRef(false);
  const lastPanPos = useRef({ x: 0, y: 0 });
  const currentOrigin = useRef({ x: 50, y: 50 });
  const currentZoomLevel = useRef(1.0);

  // Pinch
  const pinchStartDist = useRef(0);
  const pinchStartZoom = useRef(1.0);
  const pinchStartTime = useRef(0);

  // Strip scroll
  const stripScrollLastY = useRef(0);
  const scrollStartedInZone = useRef(false);

  // Trackpad
  const pcCursorPos = useRef({ x: 0, y: 0 });
  const isCursorInitialized = useRef(false);
  const lastTouchEndTime = useRef(0);
  const tpHoldTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track whether the touch originated inside the trackpad (vs video glass)
  const touchInTrackpad = useRef(false);

  // Zoomed highlighting: last normalized coords for computing PC-pixel deltas
  const lastHighlightNorm = useRef({ x: 0, y: 0 });

  // Safety timeout: auto-release mousedown if touch vanishes without end/cancel
  const highlightSafetyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Edge momentum
  const edgeMomentum = useRef<{ dx: number; dy: number; animId: number | null }>({
    dx: 0, dy: 0, animId: null,
  });
  const lastMomentumDir = useRef({ dx: 0, dy: 0 });

  // ─── Helpers ────────────────────────────────────────────────────────────────

  const setState = useCallback((s: GestureState) => {
    stateRef.current = s;
    setGestureState(s);
  }, []);

  const clearHoldTimer = useCallback(() => {
    if (holdTimer.current) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  }, []);

  const clearTpHoldTimer = useCallback(() => {
    if (tpHoldTimer.current) {
      clearTimeout(tpHoldTimer.current);
      tpHoldTimer.current = null;
    }
  }, []);

  const clearHighlightSafety = useCallback(() => {
    if (highlightSafetyTimer.current) {
      clearTimeout(highlightSafetyTimer.current);
      highlightSafetyTimer.current = null;
    }
  }, []);

  const resetZoom = useCallback(() => {
    setZoomStyle({});
    setZoomPercent(0);
    setState("idle");
    isInitialHoldTouch.current = false;
    currentOrigin.current = { x: 50, y: 50 };
    currentZoomLevel.current = 1.0;
  }, [setState]);

  const isInScrollZone = useCallback((clientX: number, clientY: number) => {
    if (!scrollRect) return false;
    return (
      clientX >= scrollRect.left &&
      clientX <= scrollRect.left + scrollRect.width &&
      clientY >= scrollRect.top &&
      clientY <= scrollRect.top + scrollRect.height
    );
  }, [scrollRect]);

  const isInTrackpad = useCallback((clientX: number, clientY: number) => {
    if (!trackpadRect) return false;
    return (
      clientX >= trackpadRect.left &&
      clientX <= trackpadRect.left + trackpadRect.width &&
      clientY >= trackpadRect.top &&
      clientY <= trackpadRect.top + trackpadRect.height
    );
  }, [trackpadRect]);

  const getTouchDist = (t1: { clientX: number; clientY: number }, t2: { clientX: number; clientY: number }) => {
    const dx = t1.clientX - t2.clientX;
    const dy = t1.clientY - t2.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const stopEdgeMomentum = useCallback(() => {
    if (edgeMomentum.current.animId !== null) {
      cancelAnimationFrame(edgeMomentum.current.animId);
      edgeMomentum.current.animId = null;
    }
  }, []);

  const updatePcCursor = useCallback((dx: number, dy: number) => {
    const { width, height } = screenDims;
    if (!width || !height) return;
    pcCursorPos.current = {
      x: Math.max(0, Math.min(width, pcCursorPos.current.x + dx)),
      y: Math.max(0, Math.min(height, pcCursorPos.current.y + dy)),
    };
    setCursorPos({ ...pcCursorPos.current });
  }, [screenDims]);

  const startEdgeMomentum = useCallback((dx: number, dy: number) => {
    edgeMomentum.current.dx = dx;
    edgeMomentum.current.dy = dy;
    if (edgeMomentum.current.animId !== null) return;
    const loop = () => {
      const { dx: mdx, dy: mdy } = edgeMomentum.current;
      sendCommand({ type: "mousemove", dx: mdx, dy: mdy });
      updatePcCursor(mdx, mdy);
      edgeMomentum.current.animId = requestAnimationFrame(loop);
    };
    edgeMomentum.current.animId = requestAnimationFrame(loop);
  }, [sendCommand, updatePcCursor]);

  // ─── Video coordinate helpers ─────────────────────────────────────────────

  const getUnscaledVideoRect = useCallback(() => {
    const video = videoRef.current;
    if (!video) return null;
    const rect = video.getBoundingClientRect();

    if (stateRef.current !== "zoomed") {
      return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    }

    const scale = currentZoomLevel.current;
    const unscaledW = rect.width / scale;
    const unscaledH = rect.height / scale;
    const ox = currentOrigin.current.x / 100;
    const oy = currentOrigin.current.y / 100;
    const originScreenX = rect.left + ox * rect.width;
    const originScreenY = rect.top + oy * rect.height;
    const unscaledLeft = originScreenX - ox * unscaledW;
    const unscaledTop = originScreenY - oy * unscaledH;

    return { left: unscaledLeft, top: unscaledTop, width: unscaledW, height: unscaledH };
  }, [videoRef]);

  const getVideoContentRect = useCallback(() => {
    const video = videoRef.current;
    if (!video) return null;

    const rect = video.getBoundingClientRect();
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return rect;

    const videoAspect = vw / vh;
    const elemAspect = rect.width / rect.height;

    if (videoAspect > elemAspect) {
      const contentH = rect.width / videoAspect;
      return {
        left: rect.left,
        top: rect.top + (rect.height - contentH) / 2,
        width: rect.width,
        height: contentH,
      };
    } else {
      const contentW = rect.height * videoAspect;
      return {
        left: rect.left + (rect.width - contentW) / 2,
        top: rect.top,
        width: contentW,
        height: rect.height,
      };
    }
  }, [videoRef]);

  const getNormalizedCoords = useCallback(
    (clientX: number, clientY: number) => {
      const rect = getVideoContentRect();
      if (!rect) return null;

      const x = (clientX - rect.left) / rect.width;
      const y = (clientY - rect.top) / rect.height;

      if (x < 0 || x > 1 || y < 0 || y > 1) return null;
      return { x, y };
    },
    [getVideoContentRect],
  );

  // ─── Clean up on mode switch / unmount ──────────────────────────────────────

  useEffect(() => {
    stopEdgeMomentum();
  }, [mode, stopEdgeMomentum]);

  useEffect(() => {
    return () => {
      clearHoldTimer();
      clearTpHoldTimer();
      clearHighlightSafety();
      stopEdgeMomentum();
    };
  }, [clearHighlightSafety, clearHoldTimer, clearTpHoldTimer, stopEdgeMomentum]);

  // ─── Voice-mode gesture logic (reused by trackpad glass area) ──────────────

  /** Handle single-finger touchStart for voice-mode style gestures (zoom/hold/tap) */
  const voiceTouchStart1 = useCallback(
    (touch: { clientX: number; clientY: number }) => {
      const state = stateRef.current;

      if (state === "zoomed") {
        // New touch while zoomed — potential precision tap, pan, or deeper zoom/highlight
        startPos.current = { x: touch.clientX, y: touch.clientY };
        lastPanPos.current = { x: touch.clientX, y: touch.clientY };
        startTime.current = Date.now();
        isInitialHoldTouch.current = false;

        clearHoldTimer();
        if (currentZoomLevel.current < SNIPER_ZOOM_LEVEL_2) {
          // Not at max zoom yet → hold for progressive zoom (2x → 3x)
          holdTimer.current = setTimeout(() => {
            currentZoomLevel.current = SNIPER_ZOOM_LEVEL_2;
            setZoomStyle((prev) => ({
              ...prev,
              transform: `scale(${SNIPER_ZOOM_LEVEL_2})`,
              transition: "transform 0.15s ease-out",
            }));
            setZoomPercent(Math.round(SNIPER_ZOOM_LEVEL_2 * 100));
          }, SNIPER_ZOOM_HOLD_MS);
        } else {
          // At max zoom (300%) → hold to start highlighting
          holdTimer.current = setTimeout(() => {
            const coords = getNormalizedCoords(startPos.current.x, startPos.current.y);
            if (coords) {
              sendCommand({ type: "moveto", x: coords.x, y: coords.y });
              sendCommand({ type: "mousedown" });
              lastHighlightNorm.current = coords;
              setState("zoomed-highlighting");
              navigator.vibrate?.(15);
              // Safety: auto-release if touch vanishes without end/cancel (e.g. incoming call)
              clearHighlightSafety();
              highlightSafetyTimer.current = setTimeout(() => {
                if (stateRef.current === "zoomed-highlighting") {
                  sendCommand({ type: "mouseup" });
                  setState("zoomed");
                }
              }, 30_000);
            }
          }, SNIPER_ZOOM_HOLD_MS);
        }
        return;
      }

      // idle → holding
      startPos.current = { x: touch.clientX, y: touch.clientY };
      startTime.current = Date.now();
      isInitialHoldTouch.current = true;
      setState("holding");

      clearHoldTimer();
      holdTimer.current = setTimeout(() => {
        const video = videoRef.current;
        if (!video) return;

        const rect = video.getBoundingClientRect();
        const originX = Math.max(0, Math.min(100,
          ((startPos.current.x - rect.left) / rect.width) * 100));
        const originY = Math.max(0, Math.min(100,
          ((startPos.current.y - rect.top) / rect.height) * 100));

        currentOrigin.current = { x: originX, y: originY };
        lastPanPos.current = { x: startPos.current.x, y: startPos.current.y };
        currentZoomLevel.current = SNIPER_ZOOM_LEVEL;

        setZoomStyle({
          transform: `scale(${SNIPER_ZOOM_LEVEL})`,
          transformOrigin: `${originX}% ${originY}%`,
          transition: "transform 0.15s ease-out",
        });
        setZoomPercent(Math.round(SNIPER_ZOOM_LEVEL * 100));
        setState("zoomed");
      }, SNIPER_ZOOM_HOLD_MS);
    },
    [clearHighlightSafety, clearHoldTimer, getNormalizedCoords, sendCommand, setState, videoRef],
  );

  /** Handle 2+ finger touchStart for pinch (voice-mode style) */
  const voiceTouchStartPinch = useCallback(
    (touches: React.TouchList) => {
      const state = stateRef.current;

      if (state === "zoomed") {
        clearHoldTimer();
        pinchStartDist.current = getTouchDist(touches[0], touches[1]);
        pinchStartZoom.current = currentZoomLevel.current;
        pinchStartTime.current = Date.now();
        setState("pinching");
        return;
      }

      if (state === "zoomed-highlighting") {
        // Release mouse before entering pinch — don't leave host with button held
        clearHoldTimer();
        clearHighlightSafety();
        sendCommand({ type: "mouseup" });
        pinchStartDist.current = getTouchDist(touches[0], touches[1]);
        pinchStartZoom.current = currentZoomLevel.current;
        pinchStartTime.current = Date.now();
        setState("pinching");
        return;
      }

      if (state === "holding") {
        clearHoldTimer();
        isInitialHoldTouch.current = false;
      }

      // If scrolling, cancel it so pinch can start
      if (state === "strip-scrolling") {
        scrollStartedInZone.current = false;
      }

      // idle, cancelled holding, or cancelled scrolling → start pinch
      if (stateRef.current === "idle" || stateRef.current === "holding" || state === "strip-scrolling") {
        const video = videoRef.current;
        if (video) {
          const rect = video.getBoundingClientRect();
          const midX = (touches[0].clientX + touches[1].clientX) / 2;
          const midY = (touches[0].clientY + touches[1].clientY) / 2;
          const originX = Math.max(0, Math.min(100, ((midX - rect.left) / rect.width) * 100));
          const originY = Math.max(0, Math.min(100, ((midY - rect.top) / rect.height) * 100));
          currentOrigin.current = { x: originX, y: originY };
          setZoomStyle((prev) => ({ ...prev, transformOrigin: `${originX}% ${originY}%` }));
        }
        pinchStartDist.current = getTouchDist(touches[0], touches[1]);
        pinchStartZoom.current = currentZoomLevel.current > 1 ? currentZoomLevel.current : 1.0;
        pinchStartTime.current = Date.now();
        setState("pinching");
      }
    },
    [clearHoldTimer, sendCommand, setState, videoRef],
  );

  // ─── Touch handlers ─────────────────────────────────────────────────────────

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      const touches = e.touches;
      const state = stateRef.current;

      // ── TRACKPAD MODE ──────────────────────────────────────────
      if (mode === "trackpad") {
        // 2+ fingers → pinch-to-zoom (don't interrupt active highlighting)
        if (touches.length >= 2) {
          clearTpHoldTimer();
          if (state === "tp-highlighting") return;

          // If already in voice-like zoom, use voice pinch logic
          if (state === "zoomed" || state === "holding") {
            voiceTouchStartPinch(touches);
            return;
          }

          // Set transform-origin to pinch midpoint
          const video = videoRef.current;
          if (video && currentZoomLevel.current <= 1) {
            const rect = video.getBoundingClientRect();
            const midX = (touches[0].clientX + touches[1].clientX) / 2;
            const midY = (touches[0].clientY + touches[1].clientY) / 2;
            const originX = Math.max(0, Math.min(100, ((midX - rect.left) / rect.width) * 100));
            const originY = Math.max(0, Math.min(100, ((midY - rect.top) / rect.height) * 100));
            currentOrigin.current = { x: originX, y: originY };
            setZoomStyle((prev) => ({ ...prev, transformOrigin: `${originX}% ${originY}%` }));
          }

          pinchStartDist.current = getTouchDist(touches[0], touches[1]);
          pinchStartZoom.current = currentZoomLevel.current > 1 ? currentZoomLevel.current : 1.0;
          pinchStartTime.current = Date.now();
          setState("pinching");
          return;
        }

        if (touches.length === 1) {
          const tx = touches[0].clientX;
          const ty = touches[0].clientY;

          // Scroll zone — ONLY if initial touch lands in zone
          if (isInScrollZone(tx, ty)) {
            scrollStartedInZone.current = true;
            stripScrollLastY.current = ty;
            setState("strip-scrolling");
            touchInTrackpad.current = false;
            return;
          }
          scrollStartedInZone.current = false;

          // Check if touch is inside the trackpad rect
          if (isInTrackpad(tx, ty)) {
            touchInTrackpad.current = true;

            // Lazy-init cursor position to screen center (once per trackpad session)
            if (!isCursorInitialized.current && screenDims.width) {
              const initPos = { x: screenDims.width / 2, y: screenDims.height / 2 };
              pcCursorPos.current = initPos;
              setCursorPos(initPos);
              isCursorInitialized.current = true;
            }
            startPos.current = { x: tx, y: ty };
            lastPanPos.current = { x: tx, y: ty };
            startTime.current = Date.now();
            setState("tp-dragging");

            // Start hold timer (250ms) → if not canceled by movement, enter highlight mode
            clearTpHoldTimer();
            tpHoldTimer.current = setTimeout(() => {
              if (stateRef.current === "tp-dragging") {
                sendCommand({ type: "mousedown" });
                setState("tp-highlighting");
                navigator.vibrate?.(15);
              }
            }, TRACKPAD_HOLD_MS);
            return;
          }

          // Touch is on the video glass (outside trackpad + scroll)
          // → route to full voice-mode gesture logic (hold-to-zoom, pan, tap)
          touchInTrackpad.current = false;
          voiceTouchStart1(touches[0]);
          return;
        }
        return;
      }

      // ── VOICE MODE ─────────────────────────────────────────────

      // 2+ fingers → pinch logic
      if (touches.length >= 2) {
        voiceTouchStartPinch(touches);
        return;
      }

      // Single finger
      if (touches.length === 1) {
        // Scroll zone check
        if (isInScrollZone(touches[0].clientX, touches[0].clientY)) {
          clearHoldTimer();
          scrollStartedInZone.current = true;
          stripScrollLastY.current = touches[0].clientY;
          setState("strip-scrolling");
          return;
        }
        scrollStartedInZone.current = false;

        voiceTouchStart1(touches[0]);
      }
    },
    [clearHoldTimer, clearTpHoldTimer, isInScrollZone, isInTrackpad, mode,
     screenDims, sendCommand, setState, videoRef, voiceTouchStart1, voiceTouchStartPinch],
  );

  const onTouchMove = useCallback(
    (e: React.TouchEvent) => {
      const touches = e.touches;
      const state = stateRef.current;

      // ── Strip scrolling (both modes) ───────────────────────────
      if (state === "strip-scrolling" && touches.length === 1 && scrollStartedInZone.current) {
        const currentY = touches[0].clientY;
        const deltaY = stripScrollLastY.current - currentY;
        stripScrollLastY.current = currentY;
        const scrollAmount = Math.round(deltaY * SCROLL_STRIP_SENSITIVITY);
        if (scrollAmount !== 0) {
          sendCommand({ type: "scroll", delta: scrollAmount });
        }
        return;
      }

      // ── Pinch zoom (both modes) ───────────────────────────────
      if (state === "pinching" && touches.length >= 2) {
        const newDist = getTouchDist(touches[0], touches[1]);
        const ratio = newDist / pinchStartDist.current;
        // Pinch in OR out, capped at SNIPER_ZOOM_LEVEL_2, floor at 1.0
        const newZoom = Math.max(1.0, Math.min(SNIPER_ZOOM_LEVEL_2, pinchStartZoom.current * ratio));
        currentZoomLevel.current = newZoom;
        if (newZoom <= 1.0) {
          // Only hard-reset if we started from a zoomed state (intentional pinch-in to unzoom).
          // If we started at 1.0x, the first onTouchMove often reads slightly less distance
          // due to finger settling → ratio dips below 1.0 → kills pinch-out before it starts.
          // Just clamp and return; onTouchEnd handles cleanup when fingers lift at 1.0x.
          if (pinchStartZoom.current > 1.0) {
            resetZoom();
          }
          return;
        }
        setZoomStyle((prev) => ({
          ...prev,
          transform: `scale(${newZoom})`,
          transition: "none",
        }));
        setZoomPercent(Math.round(newZoom * 100));
        return;
      }

      // ── Zoomed highlighting (voice mode, at max zoom) ─────────
      if (state === "zoomed-highlighting" && touches.length === 1) {
        const coords = getNormalizedCoords(touches[0].clientX, touches[0].clientY);
        if (coords) {
          const dx = (coords.x - lastHighlightNorm.current.x) * screenDims.width;
          const dy = (coords.y - lastHighlightNorm.current.y) * screenDims.height;
          lastHighlightNorm.current = coords;
          if (Math.abs(dx) > 0.1 || Math.abs(dy) > 0.1) {
            sendCommand({ type: "mousemove", dx, dy });
          }
        }
        return;
      }

      // ── TRACKPAD MODE (trackpad area gestures) ─────────────────
      if (mode === "trackpad" && touchInTrackpad.current) {
        // tp-dragging: cancel hold if moved, send relative movement
        if (state === "tp-dragging" && touches.length === 1) {
          const dx = touches[0].clientX - startPos.current.x;
          const dy = touches[0].clientY - startPos.current.y;
          if (Math.sqrt(dx * dx + dy * dy) > HOLD_SLOP_RADIUS) {
            clearTpHoldTimer();
          }
          const moveDx = touches[0].clientX - lastPanPos.current.x;
          const moveDy = touches[0].clientY - lastPanPos.current.y;
          lastPanPos.current = { x: touches[0].clientX, y: touches[0].clientY };

          const scaleX = screenDims.width ? screenDims.width / window.innerWidth : 1;
          const scaleY = screenDims.height ? screenDims.height / window.innerHeight : 1;
          const zoomFactor = currentZoomLevel.current > 1 ? currentZoomLevel.current : 1;
          const pcDx = moveDx * scaleX * TRACKPAD_MOVE_SENSITIVITY / zoomFactor;
          const pcDy = moveDy * scaleY * TRACKPAD_MOVE_SENSITIVITY / zoomFactor;

          sendCommand({ type: "mousemove", dx: pcDx, dy: pcDy });
          updatePcCursor(pcDx, pcDy);
          return;
        }

        // tp-highlighting: relative move + edge momentum
        if (state === "tp-highlighting" && touches.length === 1) {
          const moveDx = touches[0].clientX - lastPanPos.current.x;
          const moveDy = touches[0].clientY - lastPanPos.current.y;
          lastPanPos.current = { x: touches[0].clientX, y: touches[0].clientY };

          const scaleX = screenDims.width ? screenDims.width / window.innerWidth : 1;
          const scaleY = screenDims.height ? screenDims.height / window.innerHeight : 1;
          const zoomFactor = currentZoomLevel.current > 1 ? currentZoomLevel.current : 1;
          const pcDx = moveDx * scaleX * TRACKPAD_MOVE_SENSITIVITY / zoomFactor;
          const pcDy = moveDy * scaleY * TRACKPAD_MOVE_SENSITIVITY / zoomFactor;

          sendCommand({ type: "mousemove", dx: pcDx, dy: pcDy });
          updatePcCursor(pcDx, pcDy);

          // Edge momentum — direction axis-locked to which edge thumb is near,
          // NOT derived from jittery movement delta (fixes diagonal drift bug)
          const tpR = trackpadRect;
          const tx = touches[0].clientX;
          const ty = touches[0].clientY;
          const speed = EDGE_MOMENTUM_SPEED * TRACKPAD_MOVE_SENSITIVITY;
          const nearLeft = tpR ? tx < tpR.left + tpR.width * EDGE_MOMENTUM_ZONE : tx < window.innerWidth * EDGE_MOMENTUM_ZONE;
          const nearRight = tpR ? tx > tpR.left + tpR.width * (1 - EDGE_MOMENTUM_ZONE) : tx > window.innerWidth * (1 - EDGE_MOMENTUM_ZONE);
          const nearTop = tpR ? ty < tpR.top + tpR.height * EDGE_MOMENTUM_ZONE : ty < window.innerHeight * EDGE_MOMENTUM_ZONE;
          const nearBottom = tpR ? ty > tpR.top + tpR.height * (1 - EDGE_MOMENTUM_ZONE) : ty > window.innerHeight * (1 - EDGE_MOMENTUM_ZONE);
          const inEdge = nearLeft || nearRight || nearTop || nearBottom;
          if (inEdge) {
            // Axis-lock: direction comes from WHICH edge is near, not from touch delta
            const edgeDx = nearLeft ? -1 : nearRight ? 1 : 0;
            const edgeDy = nearTop ? -1 : nearBottom ? 1 : 0;
            lastMomentumDir.current = {
              dx: edgeDx * scaleX * speed,
              dy: edgeDy * scaleY * speed,
            };
            startEdgeMomentum(lastMomentumDir.current.dx, lastMomentumDir.current.dy);
          } else {
            stopEdgeMomentum();
          }
          return;
        }
        return;
      }

      // ── VOICE MODE (and trackpad glass area) ──────────────────

      // Hold slop check
      if (state === "holding" && touches.length === 1) {
        const dx = touches[0].clientX - startPos.current.x;
        const dy = touches[0].clientY - startPos.current.y;
        if (Math.sqrt(dx * dx + dy * dy) > HOLD_SLOP_RADIUS) {
          clearHoldTimer();
          setState("idle");
          isInitialHoldTouch.current = false;
        }
        return;
      }

      // Zoomed pan (with slop — micro-movement doesn't cancel highlight hold timer)
      if (state === "zoomed" && touches.length === 1) {
        const slopDx = touches[0].clientX - startPos.current.x;
        const slopDy = touches[0].clientY - startPos.current.y;
        if (Math.sqrt(slopDx * slopDx + slopDy * slopDy) <= HOLD_SLOP_RADIUS) {
          return; // Still within slop — don't pan, let hold timer survive
        }
        clearHoldTimer();
        const video = videoRef.current;
        if (!video) return;

        const rect = getUnscaledVideoRect();
        if (!rect) return;

        const dx = touches[0].clientX - lastPanPos.current.x;
        const dy = touches[0].clientY - lastPanPos.current.y;
        lastPanPos.current = { x: touches[0].clientX, y: touches[0].clientY };

        const newX = currentOrigin.current.x - (dx / rect.width) * 100;
        const newY = currentOrigin.current.y - (dy / rect.height) * 100;

        const clampedX = Math.max(0, Math.min(100, newX));
        const clampedY = Math.max(0, Math.min(100, newY));
        currentOrigin.current = { x: clampedX, y: clampedY };

        setZoomStyle((prev) => ({
          ...prev,
          transformOrigin: `${clampedX}% ${clampedY}%`,
          transition: "none",
        }));
        return;
      }
    },
    [clearHoldTimer, clearTpHoldTimer, getNormalizedCoords, getUnscaledVideoRect,
     mode, resetZoom, screenDims, sendCommand, setState, startEdgeMomentum,
     stopEdgeMomentum, trackpadRect, updatePcCursor, videoRef],
  );

  const onTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      const state = stateRef.current;
      const remainingTouches = e.touches.length;

      // ── Strip scrolling end ────────────────────────────────────
      if (state === "strip-scrolling") {
        scrollStartedInZone.current = false;
        setState("idle");
        return;
      }

      // ── Pinch end (both modes) ────────────────────────────────
      if (state === "pinching") {
        // Wait until ALL fingers lift — if one lifts early and we transition to "zoomed",
        // the remaining finger triggers the pan handler with a stale lastPanPos → snaps view.
        if (remainingTouches > 0) return;
        if (currentZoomLevel.current <= 1.0) {
          resetZoom();
        } else if (mode === "voice" || !touchInTrackpad.current) {
          // Voice mode or trackpad glass → sticky zoom
          setState("zoomed");
        } else {
          // Trackpad area: stay idle, zoom CSS persists visually
          setState("idle");
        }
        return;
      }

      // ── Zoomed highlighting end ────────────────────────────────
      if (state === "zoomed-highlighting") {
        clearHighlightSafety();
        sendCommand({ type: "mouseup" });
        const endCoords = lastHighlightNorm.current;
        onHighlightEnd({
          x: endCoords.x * screenDims.width,
          y: endCoords.y * screenDims.height,
        });
        setState("zoomed"); // stay zoomed for next action
        return;
      }

      // ── TRACKPAD MODE (trackpad area) ──────────────────────────
      if (mode === "trackpad" && touchInTrackpad.current) {
        // tp-dragging: determine if it was a tap, double-tap, or just a drag end
        if (state === "tp-dragging") {
          clearTpHoldTimer();
          const elapsed = Date.now() - startTime.current;
          const touch = e.changedTouches[0];
          const dx = touch.clientX - startPos.current.x;
          const dy = touch.clientY - startPos.current.y;
          const moved = Math.sqrt(dx * dx + dy * dy);

          if (elapsed < TRACKPAD_TAP_MAX_MS && moved < HOLD_SLOP_RADIUS) {
            const now = Date.now();
            if (now - lastTouchEndTime.current < TRACKPAD_DOUBLE_TAP_MS) {
              // Double-tap → double-click at cursor position → Copy toast
              sendCommand({ type: "double-click" });
              onDoubleClick({ ...pcCursorPos.current });
              lastTouchEndTime.current = 0;
            } else {
              // Single tap → click at cursor position
              sendCommand({ type: "click" });
              lastTouchEndTime.current = now;
            }
          }
          setState("idle");
          return;
        }

        // tp-highlighting: release selection, show Copy toast
        if (state === "tp-highlighting") {
          stopEdgeMomentum();
          sendCommand({ type: "mouseup" });
          lastTouchEndTime.current = Date.now();
          onHighlightEnd({ ...pcCursorPos.current });
          setState("idle");
          return;
        }
        return;
      }

      // ── VOICE MODE (and trackpad glass area) ──────────────────

      // Hold → quick tap (only in voice mode, not trackpad glass)
      if (state === "holding") {
        clearHoldTimer();
        if (mode === "voice") {
          const touch = e.changedTouches[0];
          const coords = getNormalizedCoords(touch.clientX, touch.clientY);
          if (coords) {
            sendCommand({ type: "tap", x: coords.x, y: coords.y });
          }
        }
        // In trackpad glass: no tap on release — video area doesn't send taps
        setState("idle");
        isInitialHoldTouch.current = false;
        return;
      }

      // Zoomed
      if (state === "zoomed") {
        clearHoldTimer();

        // Initial hold touch lifting → stay zoomed (sticky scope)
        if (isInitialHoldTouch.current) {
          isInitialHoldTouch.current = false;
          return;
        }

        // Subsequent touch while zoomed — click if quick tap (voice mode only)
        if (mode === "voice") {
          const elapsed = Date.now() - startTime.current;
          const touch = e.changedTouches[0];
          const dx = touch.clientX - startPos.current.x;
          const dy = touch.clientY - startPos.current.y;
          const moved = Math.sqrt(dx * dx + dy * dy);

          if (elapsed < SNIPER_ZOOM_HOLD_MS && moved < HOLD_SLOP_RADIUS && remainingTouches === 0) {
            const coords = getNormalizedCoords(touch.clientX, touch.clientY);
            if (coords) {
              sendCommand({ type: "tap", x: coords.x, y: coords.y });
            }
            // Stay zoomed after tap — user stays at their zoom level
          }
        }
        return;
      }
    },
    [clearHighlightSafety, clearHoldTimer, clearTpHoldTimer, getNormalizedCoords,
     mode, onDoubleClick, onHighlightEnd, resetZoom, screenDims, sendCommand,
     setState, stopEdgeMomentum],
  );

  // ─── Touch cancel — prevent infinite drift on interruption ──────────────────

  const onTouchCancel = useCallback(() => {
    clearHoldTimer();
    clearTpHoldTimer();
    clearHighlightSafety();
    stopEdgeMomentum();
    scrollStartedInZone.current = false;
    if (stateRef.current === "tp-highlighting" || stateRef.current === "zoomed-highlighting") {
      sendCommand({ type: "mouseup" });
    }
    // Return to zoomed if we were highlighting at zoom, otherwise idle
    if (stateRef.current === "zoomed-highlighting") {
      setState("zoomed");
    } else {
      setState("idle");
    }
  }, [clearHighlightSafety, clearHoldTimer, clearTpHoldTimer, sendCommand, setState, stopEdgeMomentum]);

  // Desktop mouse click fallback
  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      if (stateRef.current !== "idle") return;
      if (mode !== "voice") return;

      const coords = getNormalizedCoords(e.clientX, e.clientY);
      if (!coords) return;
      sendCommand({ type: "tap", x: coords.x, y: coords.y });
    },
    [getNormalizedCoords, mode, sendCommand],
  );

  return {
    gestureState,
    zoomStyle,
    zoomPercent,
    cursorPos,
    bind: { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel, onMouseDown },
  };
}
