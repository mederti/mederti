import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { isValidProfileRole } from "@/lib/roles";
import { checkRateLimit, getClientIp } from "@/lib/chat/rate-limit";

export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * POST { email, password, role? } — create a sign-in.
 *
 * Why this exists instead of supabase.auth.signUp(): the email-confirmation
 * flow depends on Supabase SMTP delivery + a correct Site URL + a valid TLS
 * cert on the redirect domain. All three have been unreliable in production,
 * leaving users stuck ("link never arrived" / "link said invalid"). This route
 * creates the account already-confirmed via the admin API, so NO email is
 * needed: the client then signs in with the password it just set. Email is off
 * the critical path entirely.
 *
 * Tradeoff: email ownership isn't verified at signup. Acceptable for a gated
 * product (no sensitive action keys off the address except password reset).
 * Rate-limited per IP to blunt abuse.
 */
export async function POST(req: Request) {
  const ip = getClientIp(req);
  const rl = checkRateLimit(ip);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many attempts. Please wait a minute and try again." },
      { status: 429 },
    );
  }

  let body: { email?: string; password?: string; role?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const email = (body.email ?? "").trim().toLowerCase();
  const password = body.password ?? "";
  const role = body.role;

  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
  }

  const admin = getSupabaseAdmin();

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // skip the (unreliable) confirmation email
    user_metadata: role && isValidProfileRole(role) ? { role } : undefined,
  });

  if (error) {
    const msg = (error.message ?? "").toLowerCase();
    if (msg.includes("already") || msg.includes("registered") || msg.includes("exists")) {
      return NextResponse.json(
        { error: "An account with this email already exists. Please log in instead.", code: "exists" },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: error.message || "Could not create account." }, { status: 400 });
  }

  // Persist role to user_profiles so onboarding/personalisation pick it up.
  if (role && isValidProfileRole(role) && data.user?.id) {
    try {
      await admin.from("user_profiles").upsert(
        { user_id: data.user.id, role },
        { onConflict: "user_id" },
      );
    } catch {
      /* non-blocking */
    }
  }

  // Account exists and is confirmed. The client now signs in with the password
  // (a normal, reliable password login) to establish the session.
  return NextResponse.json({ ok: true });
}
