import { NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

function getAdmin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

const GRACE_HOURS = 24;
const REMINDER_HOURS = GRACE_HOURS - 1; // fire "1 hour left" at 23h mark

async function sendReminderEmail(email: string, settingsUrl: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM_EMAIL ?? "Voicer <onboarding@resend.dev>",
      to: email,
      subject: "1 hour left — update your payment method",
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
        <tr><td style="padding-bottom:20px;">
          <p style="margin:0;font-size:14px;line-height:1.6;color:#a1a1aa;">
            You have about an hour before we&rsquo;ll have to pause your Voicer subscription.<br><br>
            We held everything open for you for the last 23 hours &mdash; just update your payment method now and you&rsquo;re all set. No interruptions, no lost settings.
          </p>
        </td></tr>
        <tr><td style="padding-bottom:32px;">
          <a href="${settingsUrl}"
             style="display:inline-block;background:#ffffff;color:#000000;font-size:15px;font-weight:600;padding:14px 32px;border-radius:12px;text-decoration:none;">
            Update payment method &rarr;
          </a>
        </td></tr>
        <tr><td style="border-top:1px solid #27272a;padding-top:24px;">
          <p style="margin:0;font-size:12px;line-height:1.6;color:#52525b;">
            Questions? Just reply to this email.
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
    console.error("cron: reminder email Resend error", await res.text());
  }
}

export async function GET(req: Request) {
  // Verify the request is from Vercel Cron (not a random caller)
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = getAdmin();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://voicers.vercel.app";
  const settingsUrl = `${siteUrl}/settings`;
  const now = Date.now();

  // ── Pass 1: "1 hour left" reminder at the 23h mark ──────────────────
  // Find failures older than 23h where reminder hasn't been sent yet
  const reminderCutoff = new Date(now - REMINDER_HOURS * 60 * 60 * 1000).toISOString();

  const { data: remindSubs, error: remindErr } = await admin
    .from("subscriptions")
    .select("id, user_id")
    .not("payment_failed_at", "is", null)
    .lt("payment_failed_at", reminderCutoff)
    .eq("payment_reminder_sent", false);

  if (remindErr) {
    console.error("cron: reminder query error", remindErr);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }

  let reminded = 0;
  for (const sub of remindSubs ?? []) {
    const { data: { user } } = await admin.auth.admin.getUserById(sub.user_id);
    if (!user?.email) continue;

    await sendReminderEmail(user.email, settingsUrl);

    await admin
      .from("subscriptions")
      .update({ payment_reminder_sent: true, updated_at: new Date().toISOString() })
      .eq("id", sub.id);

    reminded++;
  }

  // ── Pass 2: pause access at the 24h mark ─────────────────────────────
  // Find failures older than 24h where reminder was already sent (grace expired)
  const graceCutoff = new Date(now - GRACE_HOURS * 60 * 60 * 1000).toISOString();

  const { data: expiredSubs, error: expiredErr } = await admin
    .from("subscriptions")
    .select("id, user_id")
    .not("payment_failed_at", "is", null)
    .lt("payment_failed_at", graceCutoff)
    .eq("payment_reminder_sent", true);

  if (expiredErr) {
    console.error("cron: expiry query error", expiredErr);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }

  let paused = 0;
  for (const sub of expiredSubs ?? []) {
    // Downgrade to free — user must fix payment to restore
    await admin
      .from("profiles")
      .update({ plan: "free", updated_at: new Date().toISOString() })
      .eq("id", sub.user_id);

    // Clear payment_failed_at so we don't keep re-pausing on every cron tick
    await admin
      .from("subscriptions")
      .update({ payment_failed_at: null, updated_at: new Date().toISOString() })
      .eq("id", sub.id);

    paused++;
  }

  return NextResponse.json({ ok: true, reminded, paused });
}
