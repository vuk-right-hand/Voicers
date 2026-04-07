"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PLANS } from "@/lib/constants";
import type { PlanId, Subscription } from "@/types";

function SettingsContent() {
  const searchParams = useSearchParams();
  const checkoutResult = searchParams.get("checkout");
  const [plan, setPlan] = useState<PlanId>("free");
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [emailSending, setEmailSending] = useState(false);
  const [emailSent, setEmailSent] = useState(false);

  useEffect(() => {
    async function loadProfile() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setEmail(user.email ?? "");

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

      // Load subscription details
      const { data: sub } = await supabase
        .from("subscriptions")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();
      if (sub) setSubscription(sub as Subscription);

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

  async function handleCancel() {
    setCancelLoading(true);
    // Redirect to Stripe portal for cancellation (handles confirmation + date)
    const res = await fetch("/api/stripe/portal", { method: "POST" });
    const data = await res.json();
    if (data.url) {
      window.location.href = data.url;
    }
    setCancelLoading(false);
  }

  if (loading) {
    return <p className="text-zinc-400">Loading...</p>;
  }

  const isPaid = plan === "byok" || plan === "pro";
  const periodEnd = subscription?.current_period_end
    ? new Date(subscription.current_period_end).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : null;

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

      {/* Profile */}
      <div className="rounded-xl border border-zinc-800 p-5">
        <p className="text-sm text-zinc-400 mb-1">Account</p>
        <p className="text-base text-white">{email}</p>
      </div>

      {/* Current plan */}
      <div className="rounded-xl border border-zinc-800 p-5">
        <p className="text-sm text-zinc-400 mb-1">Current plan</p>
        <p className="text-xl font-semibold">
          {PLANS[plan].name} — ${PLANS[plan].price}/mo
        </p>
        {periodEnd && subscription?.status === "active" && (
          <p className="mt-1 text-xs text-zinc-500">
            Renews {periodEnd}
          </p>
        )}
        {isPaid && (
          <div className="mt-4 flex items-center gap-4">
            <button
              onClick={handlePortal}
              disabled={portalLoading}
              className="text-sm text-zinc-400 underline underline-offset-4 hover:text-white disabled:opacity-50"
            >
              {portalLoading ? "Loading..." : "Change plan"}
            </button>
            <button
              onClick={() => setShowCancelModal(true)}
              className="text-sm text-red-400/70 underline underline-offset-4 hover:text-red-400"
            >
              Cancel subscription
            </button>
          </div>
        )}
      </div>

      {/* Resend setup email — recovery path if webhook email failed */}
      {isPaid && (
        <div className="rounded-xl border border-zinc-800 p-5">
          <p className="text-sm text-zinc-400 mb-1">Setup</p>
          <p className="text-sm text-zinc-400 leading-relaxed mb-3">
            Need the verification link or installer download again?
          </p>
          <button
            onClick={async () => {
              setEmailSending(true);
              try {
                await fetch("/api/send-verify-email", { method: "POST" });
                setEmailSent(true);
              } catch { /* ignore */ }
              setEmailSending(false);
            }}
            disabled={emailSending || emailSent}
            className="text-sm text-zinc-400 underline underline-offset-4 hover:text-white disabled:opacity-50"
          >
            {emailSent ? "Check your inbox" : emailSending ? "Sending..." : "Resend setup email"}
          </button>
        </div>
      )}

      {/* Plan options for free users */}
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

      {/* Cancel confirmation modal */}
      {showCancelModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
          <div className="w-full max-w-sm rounded-2xl border border-zinc-800 bg-zinc-950 p-6 space-y-4">
            <h3 className="text-lg font-semibold">Cancel subscription?</h3>
            <p className="text-sm text-zinc-400 leading-relaxed">
              Your {PLANS[plan].name} plan will remain active until{" "}
              <span className="text-white font-medium">{periodEnd ?? "the end of your billing period"}</span>.
              After that, you&apos;ll lose access to voice commands and remote features.
            </p>
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setShowCancelModal(false)}
                className="flex-1 rounded-xl border border-zinc-700 px-4 py-2.5 text-sm font-medium text-white hover:border-zinc-500 transition-colors"
              >
                Keep plan
              </button>
              <button
                onClick={handleCancel}
                disabled={cancelLoading}
                className="flex-1 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-red-500 transition-colors disabled:opacity-50"
              >
                {cancelLoading ? "..." : "Cancel"}
              </button>
            </div>
          </div>
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
