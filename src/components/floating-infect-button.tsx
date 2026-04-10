"use client";

import { useState, useEffect, useCallback } from "react";

const TOAST_MS = 3000;

/**
 * Yellow floating share button for the landing page.
 * Fades in when the element with `targetId` scrolls out of view.
 * On tap: copies URL to clipboard, button morphs into green checkmark.
 */
export default function FloatingInfectButton({ targetId }: { targetId: string }) {
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const el = document.getElementById(targetId);
    if (!el) return;

    function onScroll() {
      const rect = el!.getBoundingClientRect();
      setVisible(rect.bottom < 64);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, [targetId]);

  const handleShare = useCallback(async () => {
    if (copied) return;
    try {
      if (navigator.share) {
        await navigator.share({ title: "Voicer", text: "Voice-code from your phone. Seriously.", url: "https://voicers.vercel.app" });
      } else {
        await navigator.clipboard.writeText("https://voicers.vercel.app");
      }
    } catch {
      // user cancelled share sheet — still show checkmark as feedback
    }
    setCopied(true);
    setTimeout(() => setCopied(false), TOAST_MS);
  }, [copied]);

  return (
    <button
      type="button"
      onClick={handleShare}
      className={`fixed top-20 z-50 inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold shadow-lg transition-all duration-300 active:scale-95 ${
        copied
          ? "bg-green-500 text-black"
          : "bg-yellow-400 text-black active:bg-yellow-300"
      } ${
        visible ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-2 pointer-events-none"
      }`}
      style={{ right: "max(1rem, calc((100vw - 42rem) / 2 - 10rem))" }}
    >
      {copied ? (
        <>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          Recruit another addict :)
        </>
      ) : (
        <>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="18" cy="5" r="3" />
            <circle cx="6" cy="12" r="3" />
            <circle cx="18" cy="19" r="3" />
            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
            <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
          </svg>
          Infect a friend
        </>
      )}
    </button>
  );
}
