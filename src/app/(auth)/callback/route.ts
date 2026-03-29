import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/session";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const { data: { user } } = await supabase.auth.getUser();

      // Only stamp device_b_linked_at when this is Device B completing the link.
      // Device A OAuth passes ?next=/login — that branch skips the stamp so Device A
      // lands back on the login page and the useEffect shows the PKCE waiting room.
      // Device B (magic link or OAuth from /verify) has no ?next param → default /session.
      const isDeviceB = next === "/session";

      if (user && isDeviceB) {
        // Always re-stamp — ensures the Realtime event fires even for re-linking flows
        const linkedAt = new Date().toISOString();
        await Promise.all([
          supabase
            .from("profiles")
            .update({ device_b_linked_at: linkedAt })
            .eq("id", user.id),
          supabase.auth.updateUser({
            data: { device_b_linked_at: linkedAt },
          }),
        ]);
      }

      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_failed`);
}
