import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { ServerTimer } from "@/lib/server-timing";
import { recordDemandSignal } from "@/lib/demand-signal";
import { getClientIp } from "@/lib/chat/rate-limit";
import { enforceRateLimit } from "@/lib/security/rate-limit";

// Pin to Mumbai to sit next to the Supabase project (ap-south-1).
// On Hobby plan this is ignored — set the project default in Vercel
// dashboard → Settings → Functions → Region instead.
export const preferredRegion = "bom1";

// 60-second edge cache. Search results for the same ?q= rarely change
// within a minute (new shortages land from scrapers running every 4h+),
// so common queries (amoxicillin, paracetamol) hit the edge repeatedly.
// Trade-off: recordDemandSignal() inside the GET only fires on cache
// miss — repeat searches within 60s from any IP don't re-log. Acceptable
// because the demand_signals table already dedupes via session_hash.
// Closes more of audit FINDING-P5-01.
export const revalidate = 60;

interface SearchHit {
  drug_id: string;
  generic_name: string;
  brand_names: string[];
  atc_code: string | null;
  active_shortage_count: number;
  alternatives_count: number;
  source: "drugs" | "catalogue";
  source_country?: string;
  source_name?: string;
  registration_number?: string;
}

// PostgrestSingleResponse-shaped value we can ignore the full type of.
type PgResult<T> = { data: T[] | null; error?: { message: string } | null };

const DRUG_COLS = "id, generic_name, brand_names, atc_code";
const CAT_COLS  = "id, drug_id, generic_name, brand_name, atc_code, source_country, source_name, registration_number";

export async function GET(req: NextRequest) {
  // Only runs on edge-cache MISS — i.e. novel ?q= values, which is exactly
  // the enumeration pattern we want to throttle. Cached repeats never reach here.
  const limited = await enforceRateLimit(req, "search");
  if (limited) return limited;

  const q = req.nextUrl.searchParams.get("q")?.trim();
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") ?? 10), 50);

  if (!q || q.length < 2) {
    return NextResponse.json({ error: "q must be at least 2 characters" }, { status: 400 });
  }

  const sb = getSupabaseAdmin();
  const timer = new ServerTimer();
  const catLimit = limit + 20; // overfetch for dedup against drugs

  // ── Round 1: drugs FTS + catalogue FTS in parallel ──────────────────
  const [drugFts, catFts] = await Promise.all([
    timer.track("db_drugs_fts", () =>
      sb.from("drugs")
        .select(DRUG_COLS)
        .textSearch("search_vector", q, { config: "english" })
        .limit(limit)
        .then((r) => r as PgResult<Record<string, unknown>>, () => ({ data: null }))
    ),
    timer.track("db_catalogue_fts", () =>
      sb.from("drug_catalogue")
        .select(CAT_COLS)
        .textSearch("search_vector", q, { config: "english" })
        .limit(catLimit)
        .then((r) => r as PgResult<Record<string, unknown>>, () => ({ data: null }))
    ),
  ]);

  let drugRows = drugFts.data ?? [];
  let catRows = catFts.data ?? [];

  // ── Round 2: ilike fallbacks (only when FTS returned nothing) ───────
  // Run any required fallbacks in parallel with each other so we don't
  // pay two RTTs in series when both branches need ilike.
  const fallbackJobs: Promise<void>[] = [];
  if (drugRows.length === 0) {
    fallbackJobs.push(
      timer
        .track("db_drugs_ilike", () =>
          sb.from("drugs")
            .select(DRUG_COLS)
            .ilike("generic_name", `%${q}%`)
            .limit(limit)
            .then((r) => r as PgResult<Record<string, unknown>>, () => ({ data: null }))
        )
        .then((r) => {
          drugRows = r.data ?? [];
        })
    );
  }
  if (catRows.length === 0) {
    fallbackJobs.push(
      timer
        .track("db_catalogue_ilike", () =>
          sb.from("drug_catalogue")
            .select(CAT_COLS)
            .ilike("generic_name", `%${q}%`)
            .limit(catLimit)
            .then((r) => r as PgResult<Record<string, unknown>>, () => ({ data: null }))
        )
        .then((r) => {
          catRows = r.data ?? [];
        })
    );
  }
  if (fallbackJobs.length > 0) await Promise.all(fallbackJobs);

  // ── Promote catalogue hits to their canonical drug ──────────────────
  // A catalogue product linked to a canonical drug (drug_id, populated by
  // backend/importers/catalogue_inn_backfill) should roll up to that INN —
  // with its real shortage count — instead of surfacing as a raw "0 active
  // shortages" product row. e.g. searching the AU brand "LORSTAT" (only in
  // the ARTG catalogue) now resolves to Atorvastatin and its live shortages.
  const drugIdSet = new Set(drugRows.map((r) => r.id as string));
  const promoteIds = [
    ...new Set(
      catRows
        .map((r) => r.drug_id as string | null)
        .filter((id): id is string => !!id && !drugIdSet.has(id))
    ),
  ];
  if (promoteIds.length > 0) {
    const promoted = await timer.track("db_promote_canonical", () =>
      sb.from("drugs")
        .select(DRUG_COLS)
        .in("id", promoteIds)
        .then((r) => r as PgResult<Record<string, unknown>>, () => ({ data: null }))
    );
    for (const row of promoted.data ?? []) {
      drugRows.push(row);
      drugIdSet.add(row.id as string);
    }
  }

  const drugIds = drugRows.map((r) => r.id as string);

  // ── Round 3: shortage + alternatives counts in parallel ─────────────
  const shortageCounts: Record<string, number> = {};
  const altCounts: Record<string, number> = {};
  if (drugIds.length > 0) {
    await Promise.all([
      timer
        .track("db_shortage_counts", () =>
          sb.from("shortage_events")
            .select("drug_id")
            .in("drug_id", drugIds)
            .in("status", ["active", "anticipated"])
            .then(
              (r) => r as PgResult<{ drug_id: string }>,
              () => ({ data: null })
            )
        )
        .then((r) => {
          for (const row of r.data ?? []) {
            shortageCounts[row.drug_id] = (shortageCounts[row.drug_id] ?? 0) + 1;
          }
        }),
      timer
        .track("db_alt_counts", () =>
          sb.from("drug_alternatives")
            .select("drug_id")
            .in("drug_id", drugIds)
            .eq("is_approved", true)
            .then(
              (r) => r as PgResult<{ drug_id: string }>,
              () => ({ data: null })
            )
        )
        .then((r) => {
          for (const row of r.data ?? []) {
            altCounts[row.drug_id] = (altCounts[row.drug_id] ?? 0) + 1;
          }
        }),
    ]);
  }

  const drugResults: SearchHit[] = drugRows.map((r) => ({
    drug_id: r.id as string,
    generic_name: r.generic_name as string,
    brand_names: (r.brand_names as string[]) ?? [],
    atc_code: (r.atc_code as string) ?? null,
    active_shortage_count: shortageCounts[r.id as string] ?? 0,
    alternatives_count: altCounts[r.id as string] ?? 0,
    source: "drugs" as const,
  }));

  // ── Dedup catalogue entries against drugs hits ──────────────────────
  const remaining = limit - drugResults.length;
  let catResults: SearchHit[] = [];

  if (remaining > 0 && catRows.length > 0) {
    const seenDrugIds = new Set(drugIds);
    const seenNames = new Set(drugRows.map((r) => (r.generic_name as string).toLowerCase()));
    const dedupedCat: Record<string, unknown>[] = [];
    const seenCatNames = new Set<string>();
    for (const r of catRows) {
      const drugId = r.drug_id as string | null;
      const gn = ((r.generic_name as string) ?? "").toLowerCase();
      if (drugId && seenDrugIds.has(drugId)) continue;
      if (seenNames.has(gn)) continue;
      if (seenCatNames.has(gn)) continue;
      seenCatNames.add(gn);
      dedupedCat.push(r);
      if (dedupedCat.length >= remaining) break;
    }

    catResults = dedupedCat.map((r) => ({
      drug_id: (r.drug_id as string) ?? (r.id as string),
      generic_name: r.generic_name as string,
      brand_names: (r.brand_name as string) ? [r.brand_name as string] : [],
      atc_code: (r.atc_code as string) ?? null,
      active_shortage_count: 0,
      alternatives_count: 0,
      source: "catalogue" as const,
      source_country: r.source_country as string,
      source_name: r.source_name as string,
      registration_number: r.registration_number as string,
    }));
  }

  const results = [...drugResults, ...catResults];

  // Demand-signal instrumentation (Sprint 3 PR 2 substrate, Sprint 4 PR 1
  // wiring). Fire-and-forget; never blocks the response. The first drug
  // result is attributed to the search signal so SUP demand queries can
  // pivot to a specific drug; raw_query carries the unresolved text when
  // there's no top hit.
  recordDemandSignal({
    signal_type: "search",
    drug_id: results[0]?.drug_id ?? null,
    raw_query: q,
    identifier: getClientIp(req),
  });

  return NextResponse.json(
    { query: q, results, total: results.length },
    { headers: timer.headers() }
  );
}
