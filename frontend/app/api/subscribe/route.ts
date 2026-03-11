import { NextRequest, NextResponse } from "next/server";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { Resend } from "resend";

let _supabase: SupabaseClient | null = null;
function getSupabase() {
  if (!_supabase) {
    _supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _supabase;
}

// Graceful: only instantiate Resend if the key is configured
const resend = process.env.RESEND_API_KEY && process.env.RESEND_API_KEY !== "re_placeholder"
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

function welcomeEmailHtml(email: string): string {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8fafc;padding:40px 20px;margin:0">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:36px 40px;border:1px solid #e2e8f0">
    <div style="font-size:20px;font-weight:700;color:#0d9488;letter-spacing:-0.02em;margin-bottom:20px">
      Mederti
    </div>
    <h1 style="font-size:22px;font-weight:700;color:#0f172a;margin:0 0 12px;letter-spacing:-0.02em">
      You're on the list.
    </h1>
    <p style="font-size:14px;color:#64748b;line-height:1.7;margin:0 0 20px">
      Thanks for signing up for Mederti intelligence. We'll keep you informed on
      global pharmaceutical shortage developments affecting your region.
    </p>
    <p style="font-size:14px;color:#64748b;line-height:1.7;margin:0 0 28px">
      You'll receive a weekly brief covering new shortages, resolved events, and
      AI-flagged supply risks — straight to your inbox.
    </p>
    <a href="https://mederti.com/dashboard"
       style="display:inline-block;padding:12px 24px;background:#0d9488;color:#fff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600">
      View the Dashboard →
    </a>
    <div style="margin-top:32px;padding-top:20px;border-top:1px solid #f1f5f9;font-size:12px;color:#94a3b8">
      Mederti · Global Pharmaceutical Shortage Intelligence<br>
      You're receiving this because ${email} signed up at mederti.com
    </div>
  </div>
</body>
</html>`;
}

export async function POST(req: NextRequest) {
  const { email, source = "landing_page" } = await req.json();

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  }

  const { error } = await getSupabase()
    .from("email_subscribers")
    .upsert({ email: email.toLowerCase().trim(), source }, { onConflict: "email" });

  if (error) {
    console.error("Subscribe error:", error);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  // Send welcome email via Resend (graceful degradation if key not configured)
  if (resend) {
    try {
      await resend.emails.send({
        from: process.env.RESEND_FROM_EMAIL ?? "intelligence@mederti.com",
        to: email.toLowerCase().trim(),
        subject: "You're on the Mederti list",
        html: welcomeEmailHtml(email),
      });
    } catch (emailErr) {
      // Log but don't fail the request — subscription was already saved
      console.error("Resend error (non-fatal):", emailErr);
    }
  } else {
    console.log(`[subscribe] RESEND_API_KEY not set — skipping welcome email to ${email}`);
  }

  return NextResponse.json({ ok: true });
}
