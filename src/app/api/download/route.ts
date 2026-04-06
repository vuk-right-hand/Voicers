import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/download?uid=<user_id>
 *
 * Serves a personalized activation file containing the user's UUID.
 * The Voicer installer reads this file from the same directory as
 * VoicerSetup.exe to pre-fill USER_ID in the host .env — zero friction.
 *
 * The uid is validated as a UUID to prevent injection. No auth required
 * because the link is emailed to the user and contains no secrets beyond
 * the user's own ID (which they already know).
 */
export async function GET(req: NextRequest) {
  const uid = req.nextUrl.searchParams.get("uid");

  // Validate UUID v4 format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uid || !uuidRegex.test(uid)) {
    return NextResponse.json({ error: "Invalid or missing uid" }, { status: 400 });
  }

  const content = `${uid}`;

  return new NextResponse(content, {
    status: 200,
    headers: {
      "Content-Type": "text/plain",
      "Content-Disposition": `attachment; filename="voicer-activation.txt"`,
      "Cache-Control": "no-store",
    },
  });
}
