"use client";

import { create } from "zustand";
import type { PcStatus } from "@/types";

interface SessionState {
  /** Whether the phone is connected to the desktop */
  isConnected: boolean;
  /** Desktop host status */
  pcStatus: PcStatus;
  /** Whether pocket mode (OLED blackout) is active */
  isPocketMode: boolean;

  setConnected: (connected: boolean) => void;
  setPcStatus: (status: PcStatus) => void;
  togglePocketMode: () => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  isConnected: false,
  pcStatus: "offline",
  isPocketMode: false,

  setConnected: (connected) => set({ isConnected: connected }),
  setPcStatus: (status) => set({ pcStatus: status }),
  togglePocketMode: () =>
    set((state) => ({ isPocketMode: !state.isPocketMode })),
}));
