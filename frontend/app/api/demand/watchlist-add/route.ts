import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { recordDemandSignal } from "@/lib/demand-signal";
import { getClientIp } from "@/lib/chat/rate-limit";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST { drug_id } — record a `watchlist_add` demand signal.
 *
 * Watchlist toggles happen client-side via Supabase RLS (no server round-trip),
 * so the signal can't be fired from a route handler the way search/drug_view
 * are. This tiny endpoint fills that gap. It is purpose-locked — it only ever
 * emits `watchlist_add` and derives the identifier server-side — so it can't be
 * abused to inject arbitrary signal types or spoof other users.
 */
export async function POST(req: Request) {
  let body: { drug_id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const drugId = body.drug_id;
  if (!drugId || !UUID_RE.test(drugId)) {
    return NextResponse.json({ error: "Invalid drug_id" }, { status: 400 });
  }

  // Identifier: authenticated user_id when available, else client IP. Both are
  // hashed with the daily-rotating salt before storage.
  let userId: string | null = null;
  try {
    const sb = await createServerClient();
    const { data: { user } } = await sb.auth.getUser();
    userId = user?.id ?? null;
  } catch {
    /* anonymous */
  }

  recordDemandSignal({
    signal_type: "watchlist_add",
    drug_id: drugId,
    identifier: userId ?? getClientIp(req),
  });

  return NextResponse.json({ ok: true });
}
