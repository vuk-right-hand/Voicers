/**
 * wake-host — Supabase Edge Function
 *
 * Reads the calling user's SwitchBot credentials from user_integrations,
 * generates a valid v1.1 HMAC-SHA256 signature, and issues a "press" command
 * to the SwitchBot Bot device (which physically pushes the PC power button).
 *
 * SwitchBot Bot must be configured in "Push" mode (not Toggle) in the app.
 * "Push" sends a single press signal — safe for waking sleeping PCs.
 *
 * Security model:
 * - Auth is validated via the user's JWT (anon client)
 * - Credentials are read via the service role key (bypasses RLS, never exposed to client)
 * - The switchbot_secret never touches the browser — only lives in this Edge Function
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SWITCHBOT_API = "https://api.switch-bot.com/v1.1";

// CORS headers required for browser preflight (OPTIONS) and actual request.
// The browser sends OPTIONS before any cross-origin POST with Authorization header.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  // ── CORS preflight — browsers ALWAYS send OPTIONS before a credentialed POST ─
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return json({ error: "Method Not Allowed" }, 405);
  }

  // ── Auth: validate user JWT via anon client ─────────────────────────────────
  // We use the anon key here solely to verify the user's identity — NOT to read
  // credentials. Credentials are fetched via service role below.
  const authClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } },
  );

  const { data: { user }, error: authErr } = await authClient.auth.getUser();
  if (authErr || !user) {
    return json({ error: "Unauthorized" }, 401);
  }

  // ── Read credentials via service role (bypasses RLS, secret never exposed to client) ─
  // The SELECT policy on user_integrations is intentionally removed — users have no
  // legitimate need to read back the switchbot_secret from the browser.
  const adminClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: integration, error: dbErr } = await adminClient
    .from("user_integrations")
    .select("switchbot_token, switchbot_secret, switchbot_device_id")
    .eq("user_id", user.id)
    .single();

  if (dbErr || !integration) {
    return json({ error: "No SwitchBot integration configured" }, 404);
  }

  const { switchbot_token, switchbot_secret, switchbot_device_id } = integration;
  if (!switchbot_token || !switchbot_secret || !switchbot_device_id) {
    return json({ error: "Incomplete SwitchBot credentials" }, 422);
  }

  // ── Build SwitchBot v1.1 HMAC-SHA256 signature ──────────────────────────────
  // sign = HMAC_SHA256(token + timestamp_ms + nonce, secret).toUpperCase()
  const t = Date.now().toString();
  const nonce = crypto.randomUUID();
  const encoder = new TextEncoder();

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(switchbot_secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signatureBuffer = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    encoder.encode(switchbot_token + t + nonce),
  );

  const sign = Array.from(new Uint8Array(signatureBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();

  // ── Issue "press" command to SwitchBot Bot ──────────────────────────────────
  // commandType "command" + command "press" = single physical button press.
  // This is safe: it wakes sleeping/off PCs without cutting AC or toggling state.
  const switchbotRes = await fetch(
    `${SWITCHBOT_API}/devices/${switchbot_device_id}/commands`,
    {
      method: "POST",
      headers: {
        "Authorization": switchbot_token,
        "sign": sign,
        "t": t,
        "nonce": nonce,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        command: "press",
        commandType: "command",
        parameter: "default",
      }),
    },
  );

  const result = await switchbotRes.json();
  return json(result, switchbotRes.status);
});
