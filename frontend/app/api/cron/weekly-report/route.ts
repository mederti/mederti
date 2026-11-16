import { NextResponse } from "next/server";
import { Resend } from "resend";
import { buildWeeklyReport } from "@/lib/admin/weekly-report";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * GET /api/cron/weekly-report
 *
 * Vercel Cron, Sundays 22:00 UTC (Monday morning in SG/AU). Emails the
 * co-founder report (users + site traffic) built by lib/admin/weekly-report.
 *
 * Auth: Authorization: Bearer <CRON_SECRET> (attached by Vercel Cron) or
 * ?secret=<CRON_SECRET>. Fails closed if the secret is unset.
 *
 * Recipients: WEEKLY_REPORT_EMAILS (comma-separated). ?dry=1 builds the
 * report and returns it without sending.
 */
export async function GET(req: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: "CRON_SECRET not configured; endpoint disabled" }, { status: 503 });
  }
  const url = new URL(req.url);
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${expected}` && url.searchParams.get("secret") !== expected) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }

  let report: Awaited<ReturnType<typeof buildWeeklyReport>>;
  try {
    report = await buildWeeklyReport();
  } catch (e) {
    // Never send a report built on a failed query.
    console.error("[weekly-report] build failed:", (e as Error).message);
    return NextResponse.json({ error: "report build failed; nothing sent" }, { status: 500 });
  }

  if (url.searchParams.get("dry") === "1") {
    if (url.searchParams.get("format") === "html") {
      return new NextResponse(report.html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }
    return NextResponse.json({ sent: false, dry: true, subject: report.subject, stats: report.stats });
  }

  const to = (process.env.WEEKLY_REPORT_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);
  if (to.length === 0) {
    return NextResponse.json({ sent: false, error: "WEEKLY_REPORT_EMAILS not set" }, { status: 503 });
  }
  const key = process.env.RESEND_API_KEY;
  if (!key || key === "re_placeholder") {
    return NextResponse.json({ sent: false, error: "RESEND_API_KEY not set" }, { status: 503 });
  }

  const { data, error } = await new Resend(key).emails.send({
    from: process.env.RESEND_FROM_EMAIL ?? "intelligence@mederti.com",
    to,
    subject: report.subject,
    html: report.html,
  });
  if (error) {
    console.error("[weekly-report] Resend rejected the send:", error.message);
    return NextResponse.json({ sent: false, error: `Resend: ${error.message}` }, { status: 502 });
  }
  return NextResponse.json({ sent: true, id: data?.id ?? null, recipients: to.length, subject: report.subject });
}
