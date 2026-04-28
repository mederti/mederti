import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * GET /api/regulatory-calendar?days=60&country=US,EU,GB,AU
 *
 * Returns upcoming regulatory events globally — used by /intelligence/calendar.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const days = Math.min(Number(url.searchParams.get("days") ?? "90"), 365);
  const countries = url.searchParams.get("country")?.split(",").map(c => c.trim().toUpperCase()) ?? null;

  const admin = getSupabaseAdmin();
  const today = new Date();
  const horizon = new Date(today.getTime() + days * 86400000);

  let query = admin
    .from("regulatory_events")
    .select("id, event_type, event_date, drug_id, generic_name, sponsor, indication, description, outcome, source_url, source_country")
    .gte("event_date", today.toISOString().slice(0, 10))
    .lte("event_date", horizon.toISOString().slice(0, 10))
    .eq("outcome", "scheduled")
    .order("event_date", { ascending: true });

  if (countries && countries.length > 0) {
    query = query.in("source_country", countries);
  }

  const { data: events, error } = await query;
  if (error) {
    console.error("regulatory-calendar:", error);
    return NextResponse.json({ events: [] }, { status: 500 });
  }

  // Enrich with drug names where drug_id exists but generic_name is null
  const drugIdsToLookup = (events ?? [])
    .filter((e) => e.drug_id && !e.generic_name)
    .map((e) => e.drug_id as string);
  if (drugIdsToLookup.length > 0) {
    const { data: drugs } = await admin
      .from("drugs")
      .select("id, generic_name")
      .in("id", drugIdsToLookup);
    const nameMap = new Map((drugs ?? []).map((d: { id: string; generic_name: string }) => [d.id, d.generic_name]));
    for (const e of events ?? []) {
      if (e.drug_id && !e.generic_name) {
        (e as { generic_name: string }).generic_name = nameMap.get(e.drug_id as string) ?? "";
      }
    }
  }

  // Group by month
  const grouped: Record<string, typeof events> = {};
  for (const e of events ?? []) {
    const month = (e.event_date as string).slice(0, 7);
    if (!grouped[month]) grouped[month] = [];
    grouped[month]!.push(e);
  }

  return NextResponse.json({
    total: events?.length ?? 0,
    horizon_days: days,
    by_month: grouped,
    events: events ?? [],
  });
}
