import { NextResponse } from "next/server";
import sitemap from "@/app/sitemap";
import { indexNowKey, submitToIndexNow } from "@/lib/indexnow";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Daily IndexNow push (Bing/Copilot freshness). Submits sitemap URLs whose
 * lastModified falls in the last 26h (monthly marketing pages excluded), so
 * we only ping what actually changed. ?all=1 submits the whole sitemap —
 * run that once after first setting INDEXNOW_KEY. ?dry=1 reports what would
 * be sent without contacting IndexNow.
 *
 * Auth mirrors /api/cron/generate-intelligence: Vercel Cron sends
 * Authorization: Bearer <CRON_SECRET>; manual runs may pass ?secret=.
 * Fails closed if CRON_SECRET is unset.
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
  if (!indexNowKey()) {
    return NextResponse.json({ error: "INDEXNOW_KEY not configured; skipping" }, { status: 503 });
  }

  const all = url.searchParams.get("all") === "1";
  const cutoff = Date.now() - 26 * 3600 * 1000;
  const entries = await sitemap();
  const urls = entries
    .filter((e) => {
      if (all) return true;
      if (e.changeFrequency === "monthly") return false;
      const t = e.lastModified ? new Date(e.lastModified).getTime() : 0;
      return t >= cutoff;
    })
    .map((e) => e.url);

  if (url.searchParams.get("dry") === "1") {
    return NextResponse.json({ dryRun: true, mode: all ? "all" : "changed", count: urls.length, sample: urls.slice(0, 10) });
  }
  if (urls.length === 0) return NextResponse.json({ submitted: 0, batches: [] });
  const result = await submitToIndexNow(urls);
  // IndexNow returns 200 (accepted) or 202 (accepted, key validation pending).
  const ok = result.batches.every((b) => b.status === 200 || b.status === 202);
  return NextResponse.json({ ...result, mode: all ? "all" : "changed" }, { status: ok ? 200 : 502 });
}
