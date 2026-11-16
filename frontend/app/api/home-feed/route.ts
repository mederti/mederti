import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { enforceRateLimit } from "@/lib/security/rate-limit";

/**
 * POST /api/home-feed  { country: "AU", drug_ids?: string[] }
 *
 * Feeds the rows under the search box on the signed-in home (/chat empty
 * state). Everything is read straight from regulator-sourced tables and every
 * item carries its source link + the date the source gives — no derived
 * scores, no forecasts.
 *
 *   watchlist      changes in the last 14 days for the caller's watched drugs
 *   anticipated    shortages the regulator has notified that have not started
 *   recalls        recalls announced in this market, last 30 days
 *   substitutions  regulator-authorised substitutions currently in force
 *   multi_country  this market's critical/high shortages that are also active
 *                  in 2+ other countries
 *   world_recalls  most recent recalls from every regulator we index
 *
 * Only public data is returned; `drug_ids` is just a filter, so no auth is
 * needed (the client reads its own watchlist under RLS and passes the ids).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = 86_400_000;

type DrugJoin = { generic_name: string | null } | { generic_name: string | null }[] | null;
const drugName = (d: DrugJoin) => (Array.isArray(d) ? d[0]?.generic_name : d?.generic_name) ?? "";
type SourceJoin = { name: string | null } | { name: string | null }[] | null;
const sourceName = (d: SourceJoin) => (Array.isArray(d) ? d[0]?.name : d?.name) ?? null;

export async function POST(req: NextRequest) {
  const limited = await enforceRateLimit(req, "browse");
  if (limited) return limited;

  let body: { country?: unknown; drug_ids?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const country =
    typeof body.country === "string" && /^[A-Za-z]{2}$/.test(body.country)
      ? body.country.toUpperCase()
      : "AU";
  const drugIds = Array.isArray(body.drug_ids)
    ? [...new Set(body.drug_ids.filter((x): x is string => typeof x === "string" && UUID.test(x)))].slice(0, 100)
    : [];

  const sb = getSupabaseAdmin();
  const now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10);
  const since14 = new Date(now - 14 * DAY).toISOString().slice(0, 10);
  const since30 = new Date(now - 30 * DAY).toISOString().slice(0, 10);

  const EVENT_COLS =
    "shortage_id, drug_id, status, severity, start_date, end_date, estimated_resolution_date, source_url, drugs(generic_name)";

  const [watchNew, watchResolved, watchAnticipated, anticipated, recalls, subs, worldRecalls, sevRows] =
    await Promise.all([
      drugIds.length
        ? sb.from("shortage_events").select(EVENT_COLS)
            .in("drug_id", drugIds).eq("country_code", country).eq("synthetic", false)
            .eq("status", "active").gte("start_date", since14).lte("start_date", today)
            .order("start_date", { ascending: false }).limit(10)
        : Promise.resolve({ data: [], error: null }),
      drugIds.length
        ? sb.from("shortage_events").select(EVENT_COLS)
            .in("drug_id", drugIds).eq("country_code", country).eq("synthetic", false)
            .eq("status", "resolved").gte("end_date", since14).lte("end_date", today)
            .order("end_date", { ascending: false }).limit(10)
        : Promise.resolve({ data: [], error: null }),
      drugIds.length
        ? sb.from("shortage_events").select(EVENT_COLS)
            .in("drug_id", drugIds).eq("country_code", country).eq("synthetic", false)
            .eq("status", "anticipated").gt("start_date", today)
            .order("start_date", { ascending: true }).limit(10)
        : Promise.resolve({ data: [], error: null }),
      sb.from("shortage_events").select(EVENT_COLS, { count: "exact" })
        .eq("country_code", country).eq("synthetic", false)
        .eq("status", "anticipated").gt("start_date", today).not("drug_id", "is", null)
        .order("start_date", { ascending: true }).limit(5),
      sb.from("recalls")
        .select("recall_id, drug_id, generic_name, recall_class, announced_date, press_release_url, drugs(generic_name)", { count: "exact" })
        .eq("country_code", country).gte("announced_date", since30).lte("announced_date", today)
        .order("announced_date", { ascending: false }).limit(4),
      sb.from("alternative_evidence")
        .select("drug_id, drug_name_raw, alternative_name_raw, publisher, valid_from, valid_until, source_url")
        .eq("country_code", country).eq("authority_type", "regulator_legal").not("drug_id", "is", null)
        .or(`valid_until.is.null,valid_until.gte.${today}`)
        .order("valid_from", { ascending: false, nullsFirst: false }).limit(200),
      sb.from("recalls")
        .select("recall_id, drug_id, generic_name, country_code, recall_class, announced_date, press_release_url, drugs(generic_name), data_sources(name)")
        .gte("announced_date", since14).lte("announced_date", today)
        .order("announced_date", { ascending: false }).limit(40),
      sb.from("shortage_events").select("drug_id, drugs(generic_name)")
        .eq("country_code", country).eq("status", "active").eq("synthetic", false)
        .in("severity", ["critical", "high"]).not("drug_id", "is", null).limit(1000),
    ]);

  // ── Watchlist changes ────────────────────────────────────────────────────
  type Ev = {
    shortage_id: string; drug_id: string | null; start_date: string | null; end_date: string | null;
    estimated_resolution_date: string | null; source_url: string | null; drugs: DrugJoin;
  };
  const watch = [
    ...((watchNew.data ?? []) as Ev[]).map((e) => ({ kind: "new" as const, date: e.start_date, e })),
    ...((watchResolved.data ?? []) as Ev[]).map((e) => ({ kind: "resolved" as const, date: e.end_date, e })),
    ...((watchAnticipated.data ?? []) as Ev[]).map((e) => ({ kind: "anticipated" as const, date: e.start_date, e })),
  ].map(({ kind, date, e }) => ({
    kind,
    date,
    drug_id: e.drug_id,
    name: drugName(e.drugs),
    estimated_resolution_date: e.estimated_resolution_date,
    source_url: e.source_url,
  })).filter((w) => w.name && w.drug_id);

  // ── Substitutions: one line per shorted product ─────────────────────────
  type Sub = {
    drug_id: string; drug_name_raw: string; alternative_name_raw: string; publisher: string;
    valid_from: string | null; valid_until: string | null; source_url: string;
  };
  const subMap = new Map<string, { s: Sub; alts: Set<string> }>();
  for (const s of (subs.data ?? []) as Sub[]) {
    const g = subMap.get(s.drug_name_raw) ?? { s, alts: new Set<string>() };
    g.alts.add(s.alternative_name_raw);
    subMap.set(s.drug_name_raw, g);
  }
  const substitutions = [...subMap.values()].slice(0, 4).map(({ s, alts }) => ({
    drug_id: s.drug_id,
    product: s.drug_name_raw,
    permitted_count: alts.size,
    publisher: s.publisher,
    valid_from: s.valid_from,
    valid_until: s.valid_until,
    source_url: s.source_url,
  }));

  // ── Multi-country: this market's critical/high drugs, active elsewhere ──
  const names = new Map<string, string>();
  for (const r of (sevRows.data ?? []) as { drug_id: string; drugs: DrugJoin }[]) {
    const n = drugName(r.drugs);
    if (n) names.set(r.drug_id, n);
  }
  const ids = [...names.keys()];
  const countriesByDrug = new Map<string, Set<string>>();
  let multiComplete = true;
  // Small chunks so no single response hits PostgREST's 1,000-row cap.
  const CHUNK = 15;
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += CHUNK) chunks.push(ids.slice(i, i + CHUNK));
  const chunkRes = await Promise.all(
    chunks.map((c) =>
      sb.from("shortage_events").select("drug_id, country_code")
        .in("drug_id", c).eq("status", "active").eq("synthetic", false)
        .not("country_code", "is", null).limit(1000),
    ),
  );
  for (const res of chunkRes) {
    if (res.error || (res.data ?? []).length >= 1000) multiComplete = false;
    for (const row of (res.data ?? []) as { drug_id: string; country_code: string }[]) {
      // "EU" is the EMA bloc feed, not a country — don't count it as one.
      if (row.country_code === "EU") continue;
      const s = countriesByDrug.get(row.drug_id) ?? new Set<string>();
      s.add(row.country_code);
      countriesByDrug.set(row.drug_id, s);
    }
  }
  const multi = [...countriesByDrug.entries()]
    .filter(([, s]) => s.size >= 3 && s.has(country))
    .sort((a, b) => b[1].size - a[1].size)
    .slice(0, 5)
    .map(([id, s]) => ({
      drug_id: id,
      name: names.get(id) ?? "",
      countries: [country, ...[...s].filter((c) => c !== country).sort()],
    }));

  type Rc = {
    recall_id: string; drug_id: string | null; generic_name: string | null; country_code?: string;
    recall_class: string | null; announced_date: string; press_release_url: string | null;
    drugs: DrugJoin; data_sources?: SourceJoin;
  };
  const mapRecall = (r: Rc) => ({
    recall_id: r.recall_id,
    drug_id: r.drug_id,
    // The regulator's own product text first — the joined canonical drug name
    // can be a mis-resolved match for multi-ingredient / complementary products.
    name: (r.generic_name ?? "").trim() || drugName(r.drugs),
    country_code: r.country_code ?? country,
    recall_class: r.recall_class,
    announced_date: r.announced_date,
    url: r.press_release_url,
    source_name: r.data_sources ? sourceName(r.data_sources) : null,
  });

  // World recalls: newest first, at most 2 per country so one busy regulator
  // doesn't fill the list. Only notices matched to a medicine (drops device
  // alerts some feeds carry), one entry per product per regulator.
  const perCountry = new Map<string, number>();
  const seen = new Set<string>();
  const world = ((worldRecalls.data ?? []) as Rc[])
    .filter((r) => r.drug_id)
    .map(mapRecall)
    .filter((r) => r.name && r.country_code !== country)
    .filter((r) => {
      const k = `${r.country_code}|${r.name.toLowerCase()}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .filter((r) => {
      const n = perCountry.get(r.country_code) ?? 0;
      perCountry.set(r.country_code, n + 1);
      return n < 2;
    })
    .slice(0, 6);

  return NextResponse.json({
    country,
    as_of: new Date(now).toISOString(),
    watchlist: watch,
    anticipated: {
      total: anticipated.count ?? 0,
      items: ((anticipated.data ?? []) as Ev[]).map((e) => ({
        drug_id: e.drug_id,
        name: drugName(e.drugs),
        start_date: e.start_date,
        source_url: e.source_url,
      })).filter((a) => a.name),
    },
    recalls: {
      total: recalls.count ?? 0,
      items: ((recalls.data ?? []) as Rc[]).map(mapRecall).filter((r) => r.name),
    },
    substitutions,
    multi_country: { complete: multiComplete, items: multi },
    world_recalls: world,
  });
}
