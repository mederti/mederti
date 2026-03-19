import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";

const resend =
  process.env.RESEND_API_KEY && process.env.RESEND_API_KEY !== "re_placeholder"
    ? new Resend(process.env.RESEND_API_KEY)
    : null;

export async function POST(req: NextRequest) {
  const { name, email, subject, message } = await req.json();

  if (!name?.trim() || !email?.trim() || !message?.trim()) {
    return NextResponse.json({ error: "Name, email, and message are required." }, { status: 400 });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Invalid email address." }, { status: 400 });
  }
  if (message.trim().length < 10) {
    return NextResponse.json({ error: "Message is too short." }, { status: 400 });
  }

  const subjectLine = subject?.trim()
    ? `[Mederti Contact] ${subject.trim()}`
    : `[Mederti Contact] Message from ${name.trim()}`;

  const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;background:#f8fafc;border-radius:12px;">
  <div style="font-size:18px;font-weight:700;color:#0F172A;margin-bottom:20px;">Mederti<span style="color:#0f172a;">.</span></div>
  <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:28px 24px;">
    <table style="width:100%;border-collapse:collapse;font-size:14px;color:#334155;">
      <tr><td style="padding:8px 0;color:#94a3b8;width:90px;vertical-align:top;">From</td><td style="padding:8px 0;font-weight:600;color:#0f172a;">${name.trim()} &lt;${email.trim()}&gt;</td></tr>
      <tr><td style="padding:8px 0;color:#94a3b8;vertical-align:top;">Subject</td><td style="padding:8px 0;">${subject?.trim() || "(no subject)"}</td></tr>
      <tr><td style="padding:8px 0;color:#94a3b8;vertical-align:top;">Message</td><td style="padding:8px 0;line-height:1.7;">${message.trim().replace(/\n/g, "<br>")}</td></tr>
    </table>
  </div>
  <div style="margin-top:16px;font-size:12px;color:#94a3b8;">Sent via mederti.com/contact</div>
</div>`;

  if (resend) {
    try {
      await resend.emails.send({
        from: process.env.RESEND_FROM_EMAIL ?? "intelligence@mederti.com",
        to: "hello@mederti.com",
        replyTo: email.trim(),
        subject: subjectLine,
        html,
      });
    } catch (err) {
      console.error("Resend error:", err);
      return NextResponse.json({ error: "Failed to send message. Please try again." }, { status: 500 });
    }
  } else {
    // Dev: log to console
    console.log("[contact] RESEND not configured — would send:", { name, email, subject, message });
  }

  return NextResponse.json({ ok: true });
}
