import { createHmac, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { enforceRateLimit } from "@/lib/security/rate-limit";

// One-click unsubscribe for the daily watchlist digest
// (backend/alerts/watchlist_digest.py). The link carries the user id and
// HMAC-SHA256(SUPABASE_SERVICE_ROLE_KEY, user_id)[:32], so it works without
// signing in and can't be forged for another user. It turns email off on all
// of the user's watches; the watches themselves stay.
//
// GET  — the link in the email body → a short confirmation page.
// POST — RFC 8058 one-click (List-Unsubscribe-Post) from mail clients.

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function valid(userId: string | null, token: string | null): userId is string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key || !userId || !token || !UUID_RE.test(userId) || token.length !== 32) return false;
  const expected = createHmac("sha256", key).update(userId).digest("hex").slice(0, 32);
  return timingSafeEqual(Buffer.from(expected), Buffer.from(token));
}

async function unsubscribe(userId: string): Promise<number> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb.from("user_watchlists").select("id, notification_channels").eq("user_id", userId);
  if (error) throw error;
  for (const w of data ?? []) {
    const channels = { ...((w.notification_channels as Record<string, unknown>) ?? {}), email: false };
    const { error: upErr } = await sb.from("user_watchlists").update({ notification_channels: channels }).eq("id", w.id);
    if (upErr) throw upErr;
  }
  return data?.length ?? 0;
}

function page(title: string, body: string, status = 200) {
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} | Mederti</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f4f5f7;margin:0;padding:48px 16px">
<div style="max-width:460px;margin:0 auto;background:#fff;border:1px solid #e8ecf0;border-radius:12px;padding:28px 32px">
<div style="font-size:18px;font-weight:700;color:#0fa676;margin-bottom:14px">Mederti</div>
<h1 style="font-size:18px;color:#0c1118;margin:0 0 8px">${title}</h1>
<p style="font-size:14px;color:#3b434e;line-height:1.6;margin:0">${body}</p></div></body></html>`;
  return new NextResponse(html, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

async function handle(req: NextRequest) {
  const limited = await enforceRateLimit(req, "strict");
  if (limited) return limited;
  const u = req.nextUrl.searchParams.get("u");
  const t = req.nextUrl.searchParams.get("t");
  if (!valid(u, t)) {
    return page("Link not valid", "This unsubscribe link is incomplete or has been changed. You can turn alerts off from your watchlist instead.", 400);
  }
  try {
    await unsubscribe(u);
  } catch (err) {
    console.error("[alerts/unsubscribe] failed:", err);
    return page("Something went wrong", "We couldn't update your alerts. Please try the link again in a minute.", 500);
  }
  return req.method === "POST"
    ? new NextResponse(null, { status: 200 })
    : page("You're unsubscribed", "You won't get watchlist emails from Mederti any more. Your watchlist is still there, and you can turn emails back on from it.");
}

export const GET = handle;
export const POST = handle;
