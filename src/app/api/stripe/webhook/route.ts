import { NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import type { PlanId } from "@/types";

function getAdmin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

function priceIdToPlan(priceId: string): PlanId {
  if (priceId === process.env.NEXT_PUBLIC_STRIPE_PRICE_PRO) return "pro";
  if (priceId === process.env.NEXT_PUBLIC_STRIPE_PRICE_BYOK) return "byok";
  console.warn("webhook: unknown price ID, falling back to free:", priceId);
  return "free";
}

// Find profile by stripe_customer_id, falling back to supabase_user_id metadata
async function findProfile(admin: ReturnType<typeof getAdmin>, customerId: string, userId?: string) {
  // Primary: lookup by stripe_customer_id
  const { data: profile } = await admin
    .from("profiles")
    .select("id")
    .eq("stripe_customer_id", customerId)
    .single();

  if (profile) return profile;

  // Fallback: checkout may not have saved customer ID yet (race condition)
  if (userId) {
    const { data: fallback } = await admin
      .from("profiles")
      .select("id")
      .eq("id", userId)
      .single();

    if (fallback) {
      // Backfill the stripe_customer_id we missed
      await admin
        .from("profiles")
        .update({ stripe_customer_id: customerId })
        .eq("id", fallback.id);
      return fallback;
    }
  }

  return null;
}

async function upsertSubscription(subscription: Stripe.Subscription, userId?: string) {
  const admin = getAdmin();
  const customerId = subscription.customer as string;

  const profile = await findProfile(admin, customerId, userId);

  if (!profile) {
    console.error("webhook: no profile found for customer", customerId);
    // Return false to signal caller should 500 so Stripe retries
    return false;
  }

  const item = subscription.items.data[0];
  const priceId = item.price.id;
  const plan = priceIdToPlan(priceId);

  const periodStart = item.current_period_start
    ? new Date(item.current_period_start * 1000).toISOString()
    : null;
  const periodEnd = item.current_period_end
    ? new Date(item.current_period_end * 1000).toISOString()
    : null;

  await admin
    .from("subscriptions")
    .upsert(
      {
        user_id: profile.id,
        stripe_subscription_id: subscription.id,
        stripe_price_id: priceId,
        status: subscription.status,
        current_period_start: periodStart,
        current_period_end: periodEnd,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "stripe_subscription_id" }
    );

  // Grace period: past_due keeps access so users aren't cut off on first failed charge
  const activePlan = ["active", "trialing", "past_due"].includes(subscription.status) ? plan : "free";
  await admin
    .from("profiles")
    .update({ plan: activePlan, updated_at: new Date().toISOString() })
    .eq("id", profile.id);

  return true;
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  const admin = getAdmin();
  const customerId = subscription.customer as string;

  const profile = await findProfile(admin, customerId);
  if (!profile) return true; // Deleted sub for unknown user — nothing to do

  await admin
    .from("subscriptions")
    .update({ status: "canceled", updated_at: new Date().toISOString() })
    .eq("stripe_subscription_id", subscription.id);

  await admin
    .from("profiles")
    .update({ plan: "free", updated_at: new Date().toISOString() })
    .eq("id", profile.id);

  return true;
}

export async function POST(req: Request) {
  const stripe = getStripe();
  const body = await req.text();
  const sig = req.headers.get("stripe-signature");

  if (!sig) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (err) {
    console.error("webhook signature verification failed:", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  let success = true;

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.subscription) {
        const subscription = await stripe.subscriptions.retrieve(session.subscription as string);
        // Pass supabase_user_id from checkout metadata as fallback for race condition
        success = await upsertSubscription(subscription, session.metadata?.supabase_user_id);
      }
      break;
    }
    case "customer.subscription.updated": {
      const subscription = event.data.object as Stripe.Subscription;
      success = await upsertSubscription(subscription);
      break;
    }
    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      success = await handleSubscriptionDeleted(subscription);
      break;
    }
  }

  if (!success) {
    return NextResponse.json({ error: "Profile not found" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
