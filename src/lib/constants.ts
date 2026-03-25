export const APP_NAME = "Voicer";
export const APP_DESCRIPTION =
  "Voice-first remote controller for vibe coding from your phone.";

export const PLANS = {
  free: { name: "Free", price: 0 },
  byok: { name: "BYOK", price: 4 },
  pro: { name: "Pro", price: 9 },
} as const;

export type PlanId = keyof typeof PLANS;

/** Hold duration (ms) to trigger sniper zoom */
export const SNIPER_ZOOM_HOLD_MS = 200;

/** Sniper zoom magnification levels */
export const SNIPER_ZOOM_LEVEL = 2.0;
export const SNIPER_ZOOM_LEVEL_2 = 3.0;

/** Scroll sensitivity multiplier for two-finger scroll */
export const SCROLL_SENSITIVITY = 3;

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
