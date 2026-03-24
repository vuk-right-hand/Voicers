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

/** Sniper zoom magnification level */
export const SNIPER_ZOOM_LEVEL = 1.5;

/** OLED blackout color for pocket mode */
export const POCKET_MODE_BG = "#000000";

/** Dev-only user ID — shared between host and PWA. Replace with real auth in Phase 2. */
export const DEV_USER_ID = "00000000-0000-0000-0000-000000000001";
