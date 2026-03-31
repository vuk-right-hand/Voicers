import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

// TODO: add Upstash Redis / Vercel KV rate limiting before production.
// The auth requirement already limits blast radius (attacker needs a valid session),
// but a token bucket per user.id would prevent repeated Resend charges.

export async function POST() {
  // Verify caller is authenticated — email is read from the session, never from client input
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Admin client: generate a magic link server-side so Device B can tap it directly.
  // This bypasses PKCE — the token is signed by the service role key, not tied to any
  // device's verifier. Device B taps → /auth/callback → stamped → /session. One email, one tap.
  const supabaseAdmin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // IMPORTANT: On Vercel, set NEXT_PUBLIC_SITE_URL=https://voicers.vercel.app
  // If this env var is missing or still set to localhost the magic link will be broken.
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://voicers.vercel.app")
    .replace(/^http:\/\/localhost(:\d+)?/, "https://voicers.vercel.app");

  if (process.env.NODE_ENV === "production" && siteUrl.includes("localhost")) {
    console.error("send-verify-email: siteUrl resolved to localhost in production — check NEXT_PUBLIC_SITE_URL env var on Vercel");
  }

  const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
    type: "magiclink",
    email: user.email,
    options: {
      redirectTo: `${siteUrl}/login`,
    },
  });

  if (linkError || !linkData.properties?.action_link) {
    console.error("generateLink error:", linkError);
    return NextResponse.json({ error: "Failed to generate link" }, { status: 500 });
  }

  const magicLink = linkData.properties.action_link;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      // NOTE: replace with your verified Resend domain before going to production
      // e.g. "Voicer <noreply@yourdomain.com>"
      from: process.env.RESEND_FROM_EMAIL ?? "Voicer <onboarding@resend.dev>",
      to: user.email,
      subject: "Connect your devices — Voicer",
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

        <tr><td style="padding-bottom:12px;">
          <p style="margin:0;font-size:18px;font-weight:600;color:#ffffff;">Connect your devices</p>
        </td></tr>

        <tr><td style="padding-bottom:24px;">
          <p style="margin:0;font-size:15px;line-height:1.6;color:#a1a1aa;">
            Tap the link below to connect this device and the device you used to sign up for Voicer.
          </p>
        </td></tr>

        <tr><td style="padding-bottom:40px;">
          <a href="${magicLink}"
             style="display:inline-block;background:#ffffff;color:#000000;font-size:15px;font-weight:600;padding:14px 32px;border-radius:12px;text-decoration:none;">
            Connect second device &rarr;
          </a>
        </td></tr>

        <tr><td style="border-top:1px solid #27272a;padding-top:24px;">
          <p style="margin:0;font-size:12px;line-height:1.6;color:#52525b;">
            This link connects a device already associated with your account.<br>
            If you didn't request this, you can safely ignore this email.
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
    console.error("Resend error:", await res.text());
    return NextResponse.json({ error: "Failed to send email" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
