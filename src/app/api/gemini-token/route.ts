import { NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { GoogleGenAI } from "@google/genai";

/**
 * Mint short-lived ephemeral Gemini Live tokens for Pro users.
 *
 * Master GEMINI_API_KEY lives ONLY on Vercel — the host receives a fresh
 * 30-min token per session and connects directly to Google's WebSocket.
 * Audio frames never traverse Vercel.
 *
 * NOTE: process.env.GEMINI_API_KEY here is the SERVER master key.
 * Do NOT confuse with host/.env GEMINI_API_KEY (BYOK user key).
 * If running Next.js locally with .env.local containing a personal key,
 * this route will mint against that personal key — keep .env.local clean.
 */

const redis = Redis.fromEnv();

// Per-user rate limit. A heavy Pro user is ~5/hour from start+restart cycles;
// 20 leaves headroom without enabling abuse.
const userRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(20, "1 h"),
  prefix: "rl:gem:user",
});

// Per-IP rate limit closes the UUID-rotation bypass — a single malicious host
// cannot multiply the cap by cycling through known Pro UUIDs.
const ipRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(40, "1 h"),
  prefix: "rl:gem:ip",
});

function getAdmin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

function getClientIp(req: Request): string {
  // Prefer x-vercel-forwarded-for — Vercel sets it from the TLS-terminated
  // connection and strips any client-supplied value, so a malicious host
  // can't spoof it to evade the per-IP rate cap. Fallback headers exist
  // only for local/preview deployments that don't go through Vercel's edge.
  const vercel = req.headers.get("x-vercel-forwarded-for");
  if (vercel) return vercel.split(",")[0].trim();
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "unknown";
}

async function logMint(
  userId: string,
  ip: string,
  outcome: "ok" | "rate_limited" | "forbidden" | "mint_failed"
) {
  try {
    const admin = getAdmin();
    await admin.from("gemini_token_mints").insert({
      user_id: userId,
      ip,
      outcome,
    });
  } catch (err) {
    console.error("[gemini-token] audit log insert failed", err);
  }
}

export async function POST(req: Request) {
  const ip = getClientIp(req);

  // Verify service role key (same pattern as /api/turn-credentials)
  const authHeader = req.headers.get("authorization");
  const expectedKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!authHeader || !expectedKey || authHeader !== `Bearer ${expectedKey}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const userId = body?.user_id;
  if (!userId || typeof userId !== "string") {
    return NextResponse.json({ error: "Missing user_id" }, { status: 400 });
  }

  // Per-IP rate limit FIRST — cheapest gate against UUID rotation
  const ipResult = await ipRatelimit.limit(ip);
  if (!ipResult.success) {
    console.warn("[gemini-token] ip rate limited", { ip, userId });
    await logMint(userId, ip, "rate_limited");
    return NextResponse.json({ error: "Rate limited" }, { status: 429 });
  }

  // Per-user rate limit
  const userResult = await userRatelimit.limit(userId);
  if (!userResult.success) {
    console.warn("[gemini-token] user rate limited", { ip, userId });
    await logMint(userId, ip, "rate_limited");
    return NextResponse.json({ error: "Rate limited" }, { status: 429 });
  }

  // Plan + subscription status check.
  // Per feedback_subscription_gate.md: NEVER gate on plan alone — churned
  // Pro users keep plan='pro' until the webhook catches up. Require an
  // active/trialing subscription as well.
  const admin = getAdmin();
  const { data: profile, error: profileErr } = await admin
    .from("profiles")
    .select("plan")
    .eq("id", userId)
    .single();

  if (profileErr || !profile) {
    console.warn("[gemini-token] profile not found", { ip, userId });
    await logMint(userId, ip, "forbidden");
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  if (profile.plan !== "pro") {
    await logMint(userId, ip, "forbidden");
    return NextResponse.json({ error: "Pro plan required" }, { status: 403 });
  }

  const { data: sub } = await admin
    .from("subscriptions")
    .select("status")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const status = sub?.status;
  if (!status || (status !== "active" && status !== "trialing")) {
    console.warn("[gemini-token] subscription not active", { ip, userId, status });
    await logMint(userId, ip, "forbidden");
    return NextResponse.json({ error: "Subscription not active" }, { status: 403 });
  }

  // Mint ephemeral token.
  // CRITICAL: httpOptions belongs on the constructor, NOT inside create().
  // The Node SDK silently drops it from the create config and falls back to
  // v1, which doesn't support ephemeral tokens — the call would then fail.
  const masterKey = process.env.GEMINI_API_KEY;
  if (!masterKey) {
    console.error("[gemini-token] GEMINI_API_KEY not configured on Vercel");
    await logMint(userId, ip, "mint_failed");
    return NextResponse.json({ error: "Service not configured" }, { status: 503 });
  }

  try {
    const client = new GoogleGenAI({
      apiKey: masterKey,
      httpOptions: { apiVersion: "v1alpha" },
    });

    // Track the expireTime we send to Google so we can return it to the host.
    // The Node SDK's AuthToken response only types `name`, so we can't read it
    // back from the response object — return our own value instead.
    const expireTimeIso = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const newSessionExpireIso = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    const token = await client.authTokens.create({
      config: {
        // uses=2 (not 1) gives one free SDK-internal reconnect using the
        // saved resumption handle without exhausting the token. Explicit
        // restart() in the host still mints a fresh token.
        uses: 2,
        // Max allowed window for message flow.
        expireTime: expireTimeIso,
        // Window to dial the first WS. 5 min covers Vercel cold-start +
        // Google mint + slow mobile tether without security cost.
        newSessionExpireTime: newSessionExpireIso,
      },
    });

    // Log response shape (keys only, not values) so we can spot a Node SDK
    // schema change in production logs without leaking the token itself.
    console.log("[gemini-token] mint response keys:", token ? Object.keys(token) : null);

    if (!token?.name) {
      console.error("[gemini-token] mint succeeded but no token.name in response", token);
      await logMint(userId, ip, "mint_failed");
      return NextResponse.json({ error: "Token mint failed" }, { status: 502 });
    }

    await logMint(userId, ip, "ok");
    return NextResponse.json({
      token: token.name,
      expireTime: expireTimeIso,
    });
  } catch (err) {
    console.error("[gemini-token] Google API error", err);
    await logMint(userId, ip, "mint_failed");
    return NextResponse.json({ error: "Token mint failed" }, { status: 502 });
  }
}
