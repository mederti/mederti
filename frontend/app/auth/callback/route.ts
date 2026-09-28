import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { isValidProfileRole } from "@/lib/roles";

export const dynamic = "force-dynamic";

// Mirrors Supabase's EmailOtpType without importing it, so a package path
// change can't break this route.
type EmailOtpType =
  | "signup"
  | "invite"
  | "magiclink"
  | "recovery"
  | "email_change"
  | "email";

function safeNext(raw: string | null): string {
  if (!raw) return "/home";
  // Only allow same-origin redirects
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/home";
  return raw;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const otpType = (url.searchParams.get("type") || "email") as EmailOtpType;
  const next = safeNext(url.searchParams.get("next"));
  const role = url.searchParams.get("role");
  const errorParam = url.searchParams.get("error");
  const errorDesc = url.searchParams.get("error_description");

  if (errorParam) {
    const back = new URL("/login", url.origin);
    back.searchParams.set("error", errorDesc || errorParam);
    return NextResponse.redirect(back);
  }

  // Two flows reach this route:
  //  • PKCE `code` — OAuth (Google/Apple) and any code-based email link.
  //  • `token_hash` + `type` — the email-OTP flow used by the magic-link and
  //    signup-confirm templates. It carries no browser-side `code_verifier`,
  //    so it survives cross-device opens and email-scanner prefetch that
  //    silently break PKCE links. Email templates point here directly.
  if (!code && !tokenHash) {
    const back = new URL("/login", url.origin);
    back.searchParams.set(
      "error",
      "That sign-in link is invalid or has expired — please sign in or request a new one."
    );
    return NextResponse.redirect(back);
  }

  const supabase = await createServerClient();
  const { data, error } = tokenHash
    ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type: otpType })
    : await supabase.auth.exchangeCodeForSession(code!);

  if (error) {
    const back = new URL("/login", url.origin);
    back.searchParams.set("error", error.message);
    return NextResponse.redirect(back);
  }

  // Persist role if provided (and valid). OAuth doesn't carry our role
  // through the provider, so it's passed via the callback query string.
  if (role && isValidProfileRole(role) && data.user?.id) {
    try {
      const admin = getSupabaseAdmin();
      // supabase-js returns { error } instead of throwing, so check it
      // explicitly — a CHECK violation (e.g. role='patient' before migration
      // 062 is applied) would otherwise leave the user with no profile row and
      // no trace in the logs.
      const { error: profileError } = await admin
        .from("user_profiles")
        .upsert({ user_id: data.user.id, role }, { onConflict: "user_id" });
      if (profileError) {
        console.error("auth/callback role upsert error:", {
          role,
          code: profileError.code,
          message: profileError.message,
        });
      }
    } catch (e) {
      console.error("auth/callback role upsert threw:", e);
    }
  }

  return NextResponse.redirect(new URL(next, url.origin));
}
