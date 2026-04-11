import { NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

/** 5 requests per hour per user — refresh is every 12h, so this is generous */
const turnRatelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(5, "1 h"),
  prefix: "rl:turn",
});

function getAdmin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * Generate ephemeral Cloudflare TURN credentials for Pro users.
 *
 * Auth: the desktop host sends its service role key as Bearer token.
 * This is a static key that never expires — avoids the JWT 1-hour expiration
 * trap for long-running Python processes.
 *
 * Security note: every host installation shares the same service role key.
 * A BYOK user could theoretically call this with a Pro user's UUID to get
 * free TURN relay. Blast radius is small (relay access only, not DB access)
 * and rate limiting per user_id mitigates abuse.
 */
export async function POST(req: Request) {
  // Verify service role key
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

  // Rate limit per user_id
  const { success } = await turnRatelimit.limit(userId);
  if (!success) {
    return NextResponse.json({ error: "Rate limited" }, { status: 429 });
  }

  // Check user plan — only Pro gets hosted TURN
  const admin = getAdmin();
  const { data: profile, error: profileErr } = await admin
    .from("profiles")
    .select("plan")
    .eq("id", userId)
    .single();

  if (profileErr || !profile) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  if (profile.plan !== "pro") {
    return NextResponse.json({ error: "Pro plan required" }, { status: 403 });
  }

  // Generate Cloudflare TURN credentials
  const keyId = process.env.CF_TURN_KEY_ID;
  const apiToken = process.env.CF_TURN_API_TOKEN;
  if (!keyId || !apiToken) {
    return NextResponse.json({ error: "TURN not configured" }, { status: 503 });
  }

  try {
    const cfRes = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${keyId}/credentials/generate-ice-servers`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ttl: 86400 }),
      }
    );

    if (!cfRes.ok) {
      console.error("turn-credentials: Cloudflare API error", cfRes.status, await cfRes.text());
      return NextResponse.json({ error: "TURN generation failed" }, { status: 502 });
    }

    const data = await cfRes.json();
    return NextResponse.json({ iceServers: data.iceServers });
  } catch (err) {
    console.error("turn-credentials: Cloudflare API error", err);
    return NextResponse.json({ error: "TURN generation failed" }, { status: 502 });
  }
}
