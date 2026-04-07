"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PLANS } from "@/lib/constants";
import type { PlanId } from "@/types";

function SettingsContent() {
  const searchParams = useSearchParams();
  const checkoutResult = searchParams.get("checkout");
  const [plan, setPlan] = useState<PlanId>("free");
  const [loading, setLoading] = useState(true);
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);

  useEffect(() => {
    async function loadProfile() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // After checkout success, poll briefly for webhook to update the plan
      const maxAttempts = checkoutResult === "success" ? 5 : 1;
      for (let i = 0; i < maxAttempts; i++) {
        const { data } = await supabase
          .from("profiles")
          .select("plan")
          .eq("id", user.id)
          .single();
        if (data) {
          setPlan(data.plan as PlanId);
          if (data.plan !== "free" || i === maxAttempts - 1) break;
        }
        if (i < maxAttempts - 1) await new Promise(r => setTimeout(r, 2000));
      }
      setLoading(false);
    }
    loadProfile();
  }, [checkoutResult]);

  async function handleCheckout(priceId: string) {
    setCheckoutLoading(priceId);
    const res = await fetch("/api/stripe/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ priceId }),
    });
    const data = await res.json();
    if (data.url) {
      window.location.href = data.url;
    }
    setCheckoutLoading(null);
  }

  async function handlePortal() {
    setPortalLoading(true);
    const res = await fetch("/api/stripe/portal", { method: "POST" });
    const data = await res.json();
    if (data.url) {
      window.location.href = data.url;
    }
    setPortalLoading(false);
  }

  if (loading) {
    return <p className="text-zinc-400">Loading...</p>;
  }

  const isPaid = plan === "byok" || plan === "pro";

  return (
    <>
      {checkoutResult === "success" && plan !== "free" && (
        <div className="rounded-xl border border-green-800 bg-green-950/50 p-4 text-sm text-green-300">
          Payment confirmed — you&apos;re on the {PLANS[plan].name} plan.
        </div>
      )}

      {checkoutResult === "success" && plan === "free" && (
        <div className="rounded-xl border border-yellow-800 bg-yellow-950/50 p-4 text-sm text-yellow-300">
          Payment received — your plan is being activated. Refresh in a moment.
        </div>
      )}

      {checkoutResult === "cancel" && (
        <div className="rounded-xl border border-zinc-700 bg-zinc-900/50 p-4 text-sm text-zinc-400">
          Checkout was canceled. Pick a plan below when you&apos;re ready.
        </div>
      )}

      {/* Current plan */}
      <div className="rounded-xl border border-zinc-800 p-5">
        <p className="text-sm text-zinc-400 mb-1">Current plan</p>
        <p className="text-xl font-semibold">
          {PLANS[plan].name} — ${PLANS[plan].price}/mo
        </p>
        {isPaid && (
          <button
            onClick={handlePortal}
            disabled={portalLoading}
            className="mt-3 text-sm text-zinc-400 underline underline-offset-4 hover:text-white disabled:opacity-50"
          >
            {portalLoading ? "Loading..." : "Manage subscription"}
          </button>
        )}
      </div>

      {/* Plan options */}
      {!isPaid && (
        <div className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Choose a plan</h2>

          <button
            onClick={() => handleCheckout(process.env.NEXT_PUBLIC_STRIPE_PRICE_BYOK!)}
            disabled={checkoutLoading !== null}
            className="flex items-center justify-between rounded-xl border border-zinc-800 p-5 text-left hover:border-zinc-600 transition-colors disabled:opacity-50"
          >
            <div>
              <p className="font-semibold">BYOK — $4/mo</p>
              <p className="text-sm text-zinc-400">Bring your own Gemini API key</p>
            </div>
            <span className="text-sm text-zinc-500">
              {checkoutLoading === process.env.NEXT_PUBLIC_STRIPE_PRICE_BYOK ? "..." : "Select"}
            </span>
          </button>

          <button
            onClick={() => handleCheckout(process.env.NEXT_PUBLIC_STRIPE_PRICE_PRO!)}
            disabled={checkoutLoading !== null}
            className="flex items-center justify-between rounded-xl border border-white/20 bg-white/5 p-5 text-left hover:border-white/40 transition-colors disabled:opacity-50"
          >
            <div>
              <p className="font-semibold">Pro — $9/mo</p>
              <p className="text-sm text-zinc-400">No API key needed — we handle everything</p>
            </div>
            <span className="text-sm text-zinc-500">
              {checkoutLoading === process.env.NEXT_PUBLIC_STRIPE_PRICE_PRO ? "..." : "Select"}
            </span>
          </button>
        </div>
      )}
    </>
  );
}

export default function SettingsPage() {
  return (
    <main className="flex flex-1 flex-col gap-8 p-6 max-w-lg mx-auto w-full">
      <h1 className="text-2xl font-bold">Settings</h1>
      <Suspense fallback={<p className="text-zinc-400">Loading...</p>}>
        <SettingsContent />
      </Suspense>
    </main>
  );
}
