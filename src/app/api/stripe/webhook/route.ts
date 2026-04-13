import { NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { buildPaymentFailedEmail, buildSubscriptionCanceledEmail } from "@/lib/billing-emails";
import type { PlanId } from "@/types";

function getAdmin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

async function sendPostCheckoutEmail(userId: string) {
  const admin = getAdmin();

  // Look up user email
  const { data: { user }, error } = await admin.auth.admin.getUserById(userId);
  if (error || !user?.email) {
    console.error("webhook: could not look up user for email", userId, error);
    return;
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://voicers.vercel.app";

  // Generate magic link for device B verification
  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: user.email,
    options: { redirectTo: `${siteUrl}/login` },
  });

  if (linkError || !linkData.properties?.action_link) {
    console.error("webhook: generateLink error", linkError);
    return;
  }

  const magicLink = linkData.properties.action_link;
  // Fetch plan to pass in URL — download page can't read profiles via RLS (user is unauthenticated)
  const { data: profile } = await admin
    .from("profiles")
    .select("plan")
    .eq("id", userId)
    .single();
  const plan = profile?.plan ?? "free";
  const downloadUrl = `${siteUrl}/download?uid=${userId}&plan=${plan}`;
  const resendUrl = `${siteUrl}/login?resend=true`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM_EMAIL ?? "Voicer <onboarding@resend.dev>",
      to: user.email,
      subject: "Welcome to Voicer — verify + install",
      html: `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#000000;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#000000;padding:48px 24px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;">
        <tr><td style="padding-bottom:32px;">
          <p style="margin:0;font-size:24px;font-weight:700;color:#ffffff;">Voicer</p>
        </td></tr>
        <tr><td style="padding-bottom:8px;">
          <p style="margin:0;font-size:18px;font-weight:600;color:#ffffff;">1. Verify your account</p>
        </td></tr>
        <tr><td style="padding-bottom:20px;">
          <p style="margin:0;font-size:14px;line-height:1.6;color:#a1a1aa;">
            Open this link in any browser to connect your devices.
          </p>
        </td></tr>
        <tr><td style="padding-bottom:12px;">
          <a href="${magicLink}"
             style="display:inline-block;background:#ffffff;color:#000000;font-size:15px;font-weight:600;padding:14px 32px;border-radius:12px;text-decoration:none;">
            Verify account &rarr;
          </a>
        </td></tr>
        <tr><td style="padding-bottom:32px;">
          <p style="margin:0;font-size:12px;color:#52525b;">
            Link expired? <a href="${resendUrl}" style="color:#a1a1aa;text-decoration:underline;">Get a new one</a>
          </p>
        </td></tr>
        <tr><td style="border-top:1px solid #27272a;padding-top:28px;padding-bottom:8px;">
          <p style="margin:0;font-size:18px;font-weight:600;color:#ffffff;">2. Install the desktop host</p>
        </td></tr>
        <tr><td style="padding-bottom:20px;">
          <p style="margin:0;font-size:14px;line-height:1.6;color:#a1a1aa;">
            Open this link on the Windows machine you want to control.<br>
            Your installer will download automatically.
          </p>
        </td></tr>
        <tr><td style="padding-bottom:12px;">
          <a href="${downloadUrl}"
             style="display:inline-block;background:#ffffff;color:#000000;font-size:15px;font-weight:600;padding:14px 32px;border-radius:12px;text-decoration:none;">
            Download for Windows
          </a>
        </td></tr>
        <tr><td style="padding-bottom:12px;">
          <p style="margin:0;font-size:12px;line-height:1.6;color:#71717a;">
            Your browser or Windows may flag the download as suspicious &mdash; this is standard for any new app.
            Click through to install. Voicer sets up a small background service so your desktop is always
            ready when you open the app on your phone.
          </p>
        </td></tr>
        <tr><td style="padding-bottom:8px;">
          <p style="margin:0;font-size:12px;color:#52525b;">macOS &mdash; coming soon</p>
        </td></tr>
        <tr><td style="padding-bottom:32px;">
          <p style="margin:0;font-size:12px;line-height:1.6;color:#71717a;">
            This link is personal to your account. Do not share it.
          </p>
        </td></tr>
        <tr><td style="border-top:1px solid #27272a;padding-top:24px;">
          <p style="margin:0;font-size:12px;line-height:1.6;color:#52525b;">
            If you didn't sign up for Voicer, you can safely ignore this email.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
    }),
  });

  if (!res.ok) {
    console.error("webhook: Resend error", await res.text());
  }
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

async function sendPaymentFailedEmail(userId: string) {
  const admin = getAdmin();
  const { data: { user }, error } = await admin.auth.admin.getUserById(userId);
  if (error || !user?.email) {
    console.error("webhook: could not look up user for dunning email", userId, error);
    return;
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://voicers.vercel.app";
  const { subject, html } = buildPaymentFailedEmail(`${siteUrl}/login`);

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM_EMAIL ?? "Voicer <onboarding@resend.dev>",
      to: user.email,
      subject,
      html,
    }),
  });

  if (!res.ok) {
    console.error("webhook: dunning email Resend error", await res.text());
  }
}

async function handlePaymentFailed(invoice: Stripe.Invoice) {
  const admin = getAdmin();
  const customerId =
    typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;

  // Stripe v22+: subscription lives under parent.subscription_details
  const subRef = invoice.parent?.subscription_details?.subscription;
  const subscriptionId = typeof subRef === "string" ? subRef : subRef?.id;

  if (!subscriptionId || !customerId) return true; // one-off invoice, not subscription

  const profile = await findProfile(admin, customerId);
  if (!profile) {
    console.error("webhook: no profile for failed payment", customerId);
    return false;
  }

  // Mark failure timestamp, reset reminder flag for this new failure cycle
  await admin
    .from("subscriptions")
    .update({
      payment_failed_at: new Date().toISOString(),
      payment_reminder_sent: false,
      updated_at: new Date().toISOString(),
    })
    .eq("stripe_subscription_id", subscriptionId);

  // Send the "24h grace" email
  await sendPaymentFailedEmail(profile.id);

  return true;
}

async function sendSubscriptionCanceledEmail(userId: string) {
  const admin = getAdmin();
  const { data: { user }, error } = await admin.auth.admin.getUserById(userId);
  if (error || !user?.email) {
    console.error("webhook: could not look up user for cancellation email", userId, error);
    return;
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://voicers.vercel.app";
  const { subject, html } = buildSubscriptionCanceledEmail(`${siteUrl}/login`);

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM_EMAIL ?? "Voicer <onboarding@resend.dev>",
      to: user.email,
      subject,
      html,
    }),
  });

  if (!res.ok) {
    console.error("webhook: cancellation email Resend error", await res.text());
  }
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

  await sendSubscriptionCanceledEmail(profile.id);

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

        // Send verify + download email now that payment is confirmed
        if (success && session.metadata?.supabase_user_id) {
          await sendPostCheckoutEmail(session.metadata.supabase_user_id);
        }
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
    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      success = await handlePaymentFailed(invoice);
      break;
    }
  }

  if (!success) {
    return NextResponse.json({ error: "Profile not found" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
