import { NextRequest, NextResponse } from "next/server";
import {
  FREE_VIEW_COOKIE,
  FREE_VIEW_COUNT_COOKIE,
  freeViewCookieOptions,
  freeViewCountCookieOptions,
  meterDrugView,
  readFreeViews,
  writeFreeViews,
} from "@/lib/free-views";

/**
 * POST { drug_id } — counts one anonymous drug-page view toward the free tier.
 * Fired by <FreeViewBeacon> once the page has actually rendered (see
 * lib/free-views.ts for why counting isn't done in the proxy). Idempotent per
 * drug. The proxy enforces the limit; this only records.
 */
export async function POST(req: NextRequest) {
  let drugId: unknown;
  try {
    drugId = ((await req.json()) as { drug_id?: unknown }).drug_id;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (typeof drugId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(drugId)) {
    return NextResponse.json({ error: "Invalid drug_id." }, { status: 400 });
  }

  const viewed = await readFreeViews(req.cookies.get(FREE_VIEW_COOKIE)?.value);
  const m = meterDrugView(viewed, drugId);
  const res = NextResponse.json({ used: m.viewed.length, allowed: m.allowed });
  if (m.changed) res.cookies.set(FREE_VIEW_COOKIE, await writeFreeViews(m.viewed), freeViewCookieOptions);
  res.cookies.set(FREE_VIEW_COUNT_COOKIE, String(m.viewed.length), freeViewCountCookieOptions);
  return res;
}
