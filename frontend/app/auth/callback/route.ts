import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const VALID_ROLES = ["pharmacist", "hospital", "supplier", "government", "default"];

function safeNext(raw: string | null): string {
  if (!raw) return "/home";
  // Only allow same-origin redirects
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/home";
  return raw;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const next = safeNext(url.searchParams.get("next"));
  const role = url.searchParams.get("role");
  const errorParam = url.searchParams.get("error");
  const errorDesc = url.searchParams.get("error_description");

  if (errorParam) {
    const back = new URL("/login", url.origin);
    back.searchParams.set("error", errorDesc || errorParam);
    return NextResponse.redirect(back);
  }

  if (!code) {
    return NextResponse.redirect(new URL("/login", url.origin));
  }

  const supabase = await createServerClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    const back = new URL("/login", url.origin);
    back.searchParams.set("error", error.message);
    return NextResponse.redirect(back);
  }

  // Persist role if provided (and valid). OAuth doesn't carry our role
  // through the provider, so it's passed via the callback query string.
  if (role && VALID_ROLES.includes(role) && data.user?.id) {
    try {
      const admin = getSupabaseAdmin();
      await admin
        .from("user_profiles")
        .upsert({ user_id: data.user.id, role }, { onConflict: "user_id" });
    } catch (e) {
      console.error("auth/callback role upsert error:", e);
    }
  }

  return NextResponse.redirect(new URL(next, url.origin));
}
