export const APP_NAME = "Voicer";
export const APP_DESCRIPTION =
  "Voice-first remote controller for vibe coding from your phone.";

export const PLANS = {
  free: { name: "Free", price: 0 },
  byok: { name: "BYOK", price: 4 },
  pro: { name: "Pro", price: 9 },
} as const;

/** Hold duration (ms) to trigger sniper zoom */
export const SNIPER_ZOOM_HOLD_MS = 200;

/** Sniper zoom magnification levels */
export const SNIPER_ZOOM_LEVEL = 2.0;
export const SNIPER_ZOOM_LEVEL_2 = 3.0;

/** Movement threshold (px) to cancel hold timer — distinguishes hold from drag */
export const HOLD_SLOP_RADIUS = 10;

/** OLED blackout color for pocket mode */
export const POCKET_MODE_BG = "#000000";

/** Dev-only user ID — shared between host and PWA. Replace with real auth in Phase 2. */
export const DEV_USER_ID = "00000000-0000-0000-0000-000000000001";

// ─── Voice Engine ───────────────────────────────────────────────────────────

/** Hold duration (ms) to trigger command wheel */
export const COMMS_HOLD_MS = 500;

/** Double-tap window (ms) for comms button dictation toggle */
export const COMMS_DOUBLE_TAP_MS = 350;

/** Audio chunk interval — how often to send PCM to host (~100ms = 1600 samples @ 16kHz) */
export const VOICE_CHUNK_INTERVAL_MS = 100;

/** Command wheel slices — ordered left-to-right across the top arch */
export const WHEEL_COMMANDS = [
  { label: "Stop", sub: "agent/server", action: "shortcut", payload: { keys: ["ctrl", "c"] } },
  { label: "Terminal", sub: "toggle", action: "shortcut", payload: { keys: ["ctrl", "`"] } },
  { label: "Send", sub: "prompt", action: "shortcut", payload: { keys: ["enter"] } },
  { label: "Clear", sub: "text", action: "sequence", payload: { steps: [["ctrl", "a"], ["backspace"]] } },
  { label: "Save", sub: "file", action: "shortcut", payload: { keys: ["ctrl", "s"] } },
] as const;

/** Dead-zone radius (px) at center of wheel — release here cancels */
export const WHEEL_DEADZONE_RADIUS = 40;

/** Wheel outer radius (px) — slices fan out to this */
export const WHEEL_RADIUS = 130;

// ─── Trackpad & Scroll Strip ────────────────────────────────────────────────

/** Scroll zone width as fraction of screen width (~6.5%) */
export const SCROLL_STRIP_WIDTH = 0.065;

/** Scroll zone height as fraction of screen height (~20%) */
export const SCROLL_STRIP_HEIGHT = 0.20;

/** Drag-px → scroll-delta multiplier for the scroll strip.
 *  pyautogui.scroll(1) = one mouse-wheel click. 1.2 → ~120 clicks per 100px drag. */
export const SCROLL_STRIP_SENSITIVITY = 1.8;

/** Trackpad height as fraction of screen in portrait (bottom 25%) */
export const TRACKPAD_HEIGHT_RATIO = 0.25;

/** Trackpad width as fraction of screen in landscape (right 20%) */
export const TRACKPAD_WIDTH_RATIO = 0.20;

/** Trackpad drag sensitivity multiplier — scales phone px → PC px */
export const TRACKPAD_MOVE_SENSITIVITY = 2.0;

/** Outer edge zone that triggers continuous cursor movement during highlight drag */
export const EDGE_MOMENTUM_ZONE = 0.10;

/** Base pixels per rAF frame for edge momentum (scaled by TRACKPAD_MOVE_SENSITIVITY) */
export const EDGE_MOMENTUM_SPEED = 2;

/** Double-tap detection window (ms) in trackpad mode */
export const TRACKPAD_DOUBLE_TAP_MS = 350;

/** Max touch duration (ms) to count as a "tap" vs a drag in trackpad mode */
export const TRACKPAD_TAP_MAX_MS = 150;

/** Hold duration (ms) to enter highlight/selection mode in trackpad */
export const TRACKPAD_HOLD_MS = 250;

/** Extraction toast auto-dismiss timeout (ms) */
export const TOAST_DISMISS_MS = 4000;

/** Paste toast auto-dismiss timeout (ms) */
export const PASTE_TOAST_DISMISS_MS = 4000;

/** Max wait (ms) for host clipboard response before resolving empty */
export const CLIPBOARD_TIMEOUT_MS = 2000;
