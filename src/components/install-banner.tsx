"use client";

import { useState, useEffect, useCallback } from "react";
import { useIsPWA } from "@/hooks/use-is-pwa";

const DISMISSED_KEY = "pwa-banner-dismissed";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function InstallBanner() {
  const isPWA = useIsPWA();
  const [dismissed, setDismissed] = useState(true); // true to avoid flash
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    setDismissed(localStorage.getItem(DISMISSED_KEY) === "1");
    setIsIOS(/iPad|iPhone|iPod/.test(navigator.userAgent));

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  const dismiss = useCallback(() => {
    localStorage.setItem(DISMISSED_KEY, "1");
    setDismissed(true);
  }, []);

  const handleInstall = useCallback(async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") dismiss();
    setDeferredPrompt(null);
  }, [deferredPrompt, dismiss]);

  if (isPWA || dismissed) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-50 flex items-start gap-3 bg-zinc-900 px-4 py-3 text-white safe-top">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium leading-snug">
          For the best experience, add <span className="font-bold">Voicer</span> to your home screen.
        </p>

        {isIOS ? (
          <p className="mt-1 text-xs text-zinc-400">
            Tap <span className="inline-flex items-center"><ShareIcon /></span>{" "}
            Share, then &quot;Add to Home Screen&quot;.
          </p>
        ) : deferredPrompt ? (
          <button
            type="button"
            onClick={handleInstall}
            className="mt-2 rounded-lg bg-white px-4 py-1.5 text-xs font-semibold text-black active:scale-95 transition-transform"
          >
            Install App
          </button>
        ) : (
          <p className="mt-1 text-xs text-zinc-400">
            Tap your browser menu, then &quot;Add to Home Screen&quot;.
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="shrink-0 p-1 text-zinc-500 hover:text-white transition-colors"
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M5 5l10 10M15 5L5 15" />
        </svg>
      </button>
    </div>
  );
}

/** Tiny iOS share icon (box with arrow) */
function ShareIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="inline -mt-0.5 mx-0.5">
      <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8" />
      <polyline points="16 6 12 2 8 6" />
      <line x1="12" y1="2" x2="12" y2="15" />
    </svg>
  );
}
