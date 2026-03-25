"use client";

import { useCallback, useRef, useState } from "react";
import type { PhoneCommand } from "@/types";
import {
  SNIPER_ZOOM_HOLD_MS,
  SNIPER_ZOOM_LEVEL,
  SNIPER_ZOOM_LEVEL_2,
  HOLD_SLOP_RADIUS,
  SCROLL_SENSITIVITY,
} from "@/lib/constants";

type GestureState = "idle" | "holding" | "zoomed" | "scrolling";

interface ZoomStyle {
  transform?: string;
  transformOrigin?: string;
  transition?: string;
}

/**
 * Gesture state machine for the video stream.
 * Handles: quick tap, sticky sniper zoom (hold 200ms), two-finger scroll.
 *
 * Touch events for mobile multi-touch, onMouseDown for desktop click fallback.
 */
export function useGestures(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  sendCommand: (cmd: PhoneCommand) => void,
) {
  const [gestureState, setGestureState] = useState<GestureState>("idle");
  const [zoomStyle, setZoomStyle] = useState<ZoomStyle>({});
  const [zoomPercent, setZoomPercent] = useState(0);

  const stateRef = useRef<GestureState>("idle");
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startPos = useRef({ x: 0, y: 0 });
  const startTime = useRef(0);
  const lastScrollY = useRef(0);
  const isInitialHoldTouch = useRef(false);
  // Delta-based panning: track last finger position and current origin %
  const lastPanPos = useRef({ x: 0, y: 0 });
  const currentOrigin = useRef({ x: 50, y: 50 });
  const currentZoomLevel = useRef(SNIPER_ZOOM_LEVEL);

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

  const resetZoom = useCallback(() => {
    setZoomStyle({});
    setZoomPercent(0);
    setState("idle");
    isInitialHoldTouch.current = false;
    currentOrigin.current = { x: 50, y: 50 };
    currentZoomLevel.current = SNIPER_ZOOM_LEVEL;
  }, [setState]);

  /**
   * Compute the video's UNSCALED bounding rect.
   * getBoundingClientRect() includes CSS transforms, so we divide out the scale.
   */
  const getUnscaledVideoRect = useCallback(() => {
    const video = videoRef.current;
    if (!video) return null;
    const rect = video.getBoundingClientRect();

    if (stateRef.current !== "zoomed") {
      return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    }

    // Reverse-engineer the unscaled rect from the scaled one + known origin
    const scale = currentZoomLevel.current;
    const unscaledW = rect.width / scale;
    const unscaledH = rect.height / scale;
    const ox = currentOrigin.current.x / 100;
    const oy = currentOrigin.current.y / 100;
    // The origin point in screen coords is at: rect.left + ox * rect.width
    // In unscaled coords, origin is at: unscaledLeft + ox * unscaledW
    // These are the same screen position, so:
    const originScreenX = rect.left + ox * rect.width;
    const originScreenY = rect.top + oy * rect.height;
    const unscaledLeft = originScreenX - ox * unscaledW;
    const unscaledTop = originScreenY - oy * unscaledH;

    return { left: unscaledLeft, top: unscaledTop, width: unscaledW, height: unscaledH };
  }, [videoRef]);

  /**
   * Get the actual video CONTENT rect, accounting for object-contain.
   * The <video> element may be larger than the rendered content (black bars).
   * Uses video.videoWidth/Height to compute where content actually renders.
   */
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
      // Video wider than element → fits width, black bars top/bottom
      const contentH = rect.width / videoAspect;
      return {
        left: rect.left,
        top: rect.top + (rect.height - contentH) / 2,
        width: rect.width,
        height: contentH,
      };
    } else {
      // Video taller → fits height, black bars left/right
      const contentW = rect.height * videoAspect;
      return {
        left: rect.left + (rect.width - contentW) / 2,
        top: rect.top,
        width: contentW,
        height: rect.height,
      };
    }
  }, [videoRef]);

  /**
   * Map screen touch coords to normalized (0-1) video content coords.
   * Returns null if touch lands on black bars (outside video content).
   */
  const getNormalizedCoords = useCallback(
    (clientX: number, clientY: number) => {
      const rect = getVideoContentRect();
      if (!rect) return null;

      const x = (clientX - rect.left) / rect.width;
      const y = (clientY - rect.top) / rect.height;

      // Reject taps on black bars
      if (x < 0 || x > 1 || y < 0 || y > 1) return null;

      return { x, y };
    },
    [getVideoContentRect],
  );

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      const touches = e.touches;
      const state = stateRef.current;

      // 2+ fingers while zoomed → cancel zoom (no click)
      if (touches.length >= 2 && state === "zoomed") {
        clearHoldTimer();
        resetZoom();
        return;
      }

      // 2+ fingers while holding → cancel hold, start scroll
      if (touches.length >= 2 && state === "holding") {
        clearHoldTimer();
        lastScrollY.current = (touches[0].clientY + touches[1].clientY) / 2;
        setState("scrolling");
        return;
      }

      // 2 fingers while idle → prepare for scroll
      if (touches.length === 2 && state === "idle") {
        clearHoldTimer();
        lastScrollY.current = (touches[0].clientY + touches[1].clientY) / 2;
        setState("scrolling");
        return;
      }

      // Single finger
      if (touches.length === 1) {
        const touch = touches[0];

        if (state === "zoomed") {
          // New touch while zoomed — potential precision tap, pan, or deeper zoom
          startPos.current = { x: touch.clientX, y: touch.clientY };
          lastPanPos.current = { x: touch.clientX, y: touch.clientY };
          startTime.current = Date.now();
          isInitialHoldTouch.current = false;

          // Start hold timer for progressive zoom (150% → 200%)
          if (currentZoomLevel.current < SNIPER_ZOOM_LEVEL_2) {
            clearHoldTimer();
            holdTimer.current = setTimeout(() => {
              currentZoomLevel.current = SNIPER_ZOOM_LEVEL_2;
              setZoomStyle((prev) => ({
                ...prev,
                transform: `scale(${SNIPER_ZOOM_LEVEL_2})`,
                transition: "transform 0.15s ease-out",
              }));
              setZoomPercent(Math.round(SNIPER_ZOOM_LEVEL_2 * 100));
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

          // Origin computed BEFORE scale — rect is still unscaled at this point
          const rect = video.getBoundingClientRect();
          const originX = Math.max(0, Math.min(100,
            ((startPos.current.x - rect.left) / rect.width) * 100));
          const originY = Math.max(0, Math.min(100,
            ((startPos.current.y - rect.top) / rect.height) * 100));

          currentOrigin.current = { x: originX, y: originY };
          lastPanPos.current = { x: startPos.current.x, y: startPos.current.y };

          setZoomStyle({
            transform: `scale(${SNIPER_ZOOM_LEVEL})`,
            transformOrigin: `${originX}% ${originY}%`,
            transition: "transform 0.15s ease-out",
          });
          setZoomPercent(Math.round(SNIPER_ZOOM_LEVEL * 100));
          setState("zoomed");
        }, SNIPER_ZOOM_HOLD_MS);
      }
    },
    [clearHoldTimer, resetZoom, setState, videoRef],
  );

  const onTouchMove = useCallback(
    (e: React.TouchEvent) => {
      const touches = e.touches;
      const state = stateRef.current;

      // 2+ fingers during zoom → cancel
      if (touches.length >= 2 && state === "zoomed") {
        clearHoldTimer();
        resetZoom();
        return;
      }

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

      if (state === "zoomed" && touches.length === 1) {
        // Moving while zoomed cancels progressive zoom hold
        clearHoldTimer();
        // Delta-based pan: finger drags content with it (like a map).
        // Finger moves RIGHT → we want to see more LEFT → origin moves LEFT.
        // So origin moves in the SAME direction as the finger.
        const video = videoRef.current;
        if (!video) return;

        // Use unscaled dimensions for converting pixel delta to origin %
        const rect = getUnscaledVideoRect();
        if (!rect) return;

        const dx = touches[0].clientX - lastPanPos.current.x;
        const dy = touches[0].clientY - lastPanPos.current.y;
        lastPanPos.current = { x: touches[0].clientX, y: touches[0].clientY };

        // Finger right (+dx) → show more left → origin decreases
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

      if (state === "scrolling" && touches.length === 2) {
        const currentY = (touches[0].clientY + touches[1].clientY) / 2;
        const deltaY = lastScrollY.current - currentY;
        lastScrollY.current = currentY;

        const scrollAmount = Math.round(deltaY * SCROLL_SENSITIVITY * 0.1);
        if (scrollAmount !== 0) {
          sendCommand({ type: "scroll", delta: scrollAmount });
        }
        return;
      }
    },
    [clearHoldTimer, getUnscaledVideoRect, resetZoom, sendCommand, setState],
  );

  const onTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      const state = stateRef.current;
      const remainingTouches = e.touches.length;

      if (state === "holding") {
        clearHoldTimer();
        const touch = e.changedTouches[0];
        const coords = getNormalizedCoords(touch.clientX, touch.clientY);
        if (coords) {
          sendCommand({ type: "tap", x: coords.x, y: coords.y });
        }
        setState("idle");
        isInitialHoldTouch.current = false;
        return;
      }

      if (state === "zoomed") {
        clearHoldTimer();

        // Initial hold touch lifting → stay zoomed (sticky scope)
        if (isInitialHoldTouch.current) {
          isInitialHoldTouch.current = false;
          return;
        }

        // Subsequent touch while zoomed — click if quick tap, STAY zoomed either way
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
        }
        // Always stay zoomed — only 2-finger cancels zoom
        return;
      }

      if (state === "scrolling" && remainingTouches < 2) {
        setState("idle");
        return;
      }
    },
    [clearHoldTimer, getNormalizedCoords, resetZoom, sendCommand, setState],
  );

  // Desktop mouse click fallback (touch events don't fire from mouse)
  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      if (stateRef.current !== "idle") return;

      const coords = getNormalizedCoords(e.clientX, e.clientY);
      if (!coords) return; // clicked on black bar
      sendCommand({ type: "tap", x: coords.x, y: coords.y });
    },
    [getNormalizedCoords, sendCommand],
  );

  return {
    gestureState,
    zoomStyle,
    zoomPercent,
    bind: { onTouchStart, onTouchMove, onTouchEnd, onMouseDown },
  };
}
