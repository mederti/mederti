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

  // ── Filters (server-side, URL-param driven) ─────────────────────────
  // market: a 2-letter country (default AU) or "ALL" for the legacy global
  //   scope. A molecule qualifies under a market if it is *registered-in*
  //   (drug_catalogue.source_country) OR *short-in* (shortage_events
  //   .country_code) that market — the union semantic.
  // status: comma-joined subset of shortage | supply | resolved.
  // sort:   relevance (default) | resolution | severity.
  const sp = req.nextUrl.searchParams;
  const market = (sp.get("market")?.trim().toUpperCase() || "AU");
  const isGlobal = market === "ALL";
  const statusKeys = new Set(
    (sp.get("status") ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s === "shortage" || s === "supply" || s === "resolved")
  );
  const sort = (() => {
    const s = sp.get("sort")?.trim().toLowerCase();
    return s === "resolution" || s === "severity" ? s : "relevance";
  })();
  const hasFilter = !isGlobal || statusKeys.size > 0;
  // Over-fetch the FTS pool when filters are active so server-side filtering
  // doesn't starve the capped result slice. Cheap: FTS is indexed.
  const pool = hasFilter ? Math.max(limit, 120) : limit;

  const sb = getSupabaseAdmin();
  const timer = new ServerTimer();
  const catLimit = pool + 20; // overfetch for dedup against drugs

  // ── Round 1: drugs FTS + catalogue FTS in parallel ──────────────────
  const [drugFts, catFts] = await Promise.all([
    timer.track("db_drugs_fts", () =>
      sb.from("drugs")
        .select(DRUG_COLS)
        .textSearch("search_vector", q, { config: "english" })
        .limit(pool)
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
            .limit(pool)
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

  // ── Round 3: market-aware shortage aggregation + registration set + alts ──
  // shortage_events are scoped to the chosen market (unless ALL) so the count
  // badge, status buckets, and sort keys all reflect that market.
  type Agg = { active: number; resolvedRecent: number; minRes: number | null; maxSev: number };
  const agg: Record<string, Agg> = {};
  const registeredInMarket = new Set<string>();
  const altCounts: Record<string, number> = {};
  const SEV: Record<string, number> = { critical: 3, high: 2, medium: 1 };
  const RESOLVED_WINDOW_MS = 90 * 24 * 3600 * 1000;
  const now = Date.now();

  if (drugIds.length > 0) {
    const jobs: Promise<void>[] = [];

    jobs.push(
      timer
        .track("db_shortage_agg", () => {
          let qb = sb
            .from("shortage_events")
            .select("drug_id,status,end_date,severity,estimated_resolution_date")
            .in("drug_id", drugIds);
          if (!isGlobal) qb = qb.eq("country_code", market);
          return qb.then(
            (r) =>
              r as PgResult<{
                drug_id: string;
                status: string;
                end_date: string | null;
                severity: string | null;
                estimated_resolution_date: string | null;
              }>,
            () => ({ data: null })
          );
        })
        .then((r) => {
          for (const row of r.data ?? []) {
            const a = (agg[row.drug_id] ??= { active: 0, resolvedRecent: 0, minRes: null, maxSev: 0 });
            if (row.status === "active" || row.status === "anticipated") {
              a.active++;
              if (row.estimated_resolution_date) {
                const t = Date.parse(row.estimated_resolution_date);
                if (!Number.isNaN(t) && (a.minRes === null || t < a.minRes)) a.minRes = t;
              }
              const sev = SEV[(row.severity ?? "").toLowerCase()] ?? 0;
              if (sev > a.maxSev) a.maxSev = sev;
            } else if (row.status === "resolved" && row.end_date) {
              const t = Date.parse(row.end_date);
              if (!Number.isNaN(t) && now - t <= RESOLVED_WINDOW_MS) a.resolvedRecent++;
            }
          }
        })
    );

    // registered-in-market set — catalogue products for these drugs in the market
    if (!isGlobal) {
      jobs.push(
        timer
          .track("db_registered_in_market", () =>
            sb
              .from("drug_catalogue")
              .select("drug_id")
              .eq("source_country", market)
              .in("drug_id", drugIds)
              .then((r) => r as PgResult<{ drug_id: string | null }>, () => ({ data: null }))
          )
          .then((r) => {
            for (const row of r.data ?? []) if (row.drug_id) registeredInMarket.add(row.drug_id);
          })
      );
    }

    jobs.push(
      timer
        .track("db_alt_counts", () =>
          sb
            .from("drug_alternatives")
            .select("drug_id")
            .in("drug_id", drugIds)
            .eq("is_approved", true)
            .then((r) => r as PgResult<{ drug_id: string }>, () => ({ data: null }))
        )
        .then((r) => {
          for (const row of r.data ?? []) altCounts[row.drug_id] = (altCounts[row.drug_id] ?? 0) + 1;
        })
    );

    await Promise.all(jobs);
  }

  // Market union: a molecule qualifies if registered-in OR short-in the market.
  const marketMatchDrug = (id: string): boolean =>
    isGlobal ||
    registeredInMarket.has(id) ||
    (agg[id]?.active ?? 0) > 0 ||
    (agg[id]?.resolvedRecent ?? 0) > 0;

  // Status buckets are independent multi-select toggles.
  const statusMatch = (id: string): boolean => {
    if (statusKeys.size === 0) return true;
    const a = agg[id];
    const isShort = (a?.active ?? 0) > 0;
    const isResolved = (a?.resolvedRecent ?? 0) > 0;
    return (
      (statusKeys.has("shortage") && isShort) ||
      (statusKeys.has("resolved") && isResolved) ||
      (statusKeys.has("supply") && !isShort)
    );
  };

  // Internal ranked shape carries sort keys stripped before the response.
  type Ranked = SearchHit & { _res: number | null; _sev: number };

  // Market-scoped molecule pool (before the status filter) — used both for the
  // status facet counts and as the basis for the displayed drug results.
  const marketDrugs: Ranked[] = drugRows
    .map((r): Ranked => {
      const id = r.id as string;
      const a = agg[id];
      return {
        drug_id: id,
        generic_name: r.generic_name as string,
        brand_names: (r.brand_names as string[]) ?? [],
        atc_code: (r.atc_code as string) ?? null,
        active_shortage_count: a?.active ?? 0,
        alternatives_count: altCounts[id] ?? 0,
        source: "drugs",
        _res: a?.minRes ?? null,
        _sev: a?.maxSev ?? 0,
      };
    })
    .filter((r) => marketMatchDrug(r.drug_id));

  // ── Catalogue candidates: market-filtered + deduped, independent of the
  // status selection so the supply facet stays honest. Dedup collapses to one
  // row per linked molecule (drug_id) — otherwise multi-strength products like
  // CADUET 5/10…10/80 each surface as a separate row — falling back to the
  // generic-name string when a catalogue row isn't linked to a canonical drug.
  const catCandidates: Ranked[] = [];
  {
    const seenDrugIds = new Set(marketDrugs.map((r) => r.drug_id));
    const seenNames = new Set(marketDrugs.map((r) => r.generic_name.toLowerCase()));
    const seenCatNames = new Set<string>();
    for (const r of catRows) {
      // Cap at the fetch pool, not the page limit, so facet counts and `total`
      // are consistent with the molecule pool. The page slice happens later.
      if (catCandidates.length >= pool) break;
      const drugId = r.drug_id as string | null;
      const gn = ((r.generic_name as string) ?? "").toLowerCase();
      const country = ((r.source_country as string) ?? "").toUpperCase();
      if (!isGlobal && country !== market) continue;
      if (drugId && seenDrugIds.has(drugId)) continue;
      if (!drugId && (seenNames.has(gn) || seenCatNames.has(gn))) continue;
      if (drugId) seenDrugIds.add(drugId);
      seenCatNames.add(gn);
      catCandidates.push({
        drug_id: drugId ?? (r.id as string),
        generic_name: r.generic_name as string,
        brand_names: (r.brand_name as string) ? [r.brand_name as string] : [],
        atc_code: (r.atc_code as string) ?? null,
        active_shortage_count: 0,
        alternatives_count: 0,
        source: "catalogue",
        source_country: r.source_country as string,
        source_name: r.source_name as string,
        registration_number: r.registration_number as string,
        _res: null,
        _sev: 0,
      });
    }
  }

  // Status facet counts (free — agg + catalogue candidates already in hand).
  // Molecules counted by their shortage rollup; catalogue products are all
  // "in supply". Independent toggles, so buckets can overlap.
  const facetStatus = { shortage: 0, supply: 0, resolved: 0 };
  for (const r of marketDrugs) {
    const a = agg[r.drug_id];
    if ((a?.active ?? 0) > 0) facetStatus.shortage++;
    else facetStatus.supply++;
    if ((a?.resolvedRecent ?? 0) > 0) facetStatus.resolved++;
  }
  facetStatus.supply += catCandidates.length;

  // Catalogue rows only satisfy the supply bucket; drop them when the status
  // filter is set and excludes supply.
  const catEligible = statusKeys.size === 0 || statusKeys.has("supply");
  const drugResults: Ranked[] =
    statusKeys.size === 0 ? marketDrugs : marketDrugs.filter((r) => statusMatch(r.drug_id));
  const catResults: Ranked[] = catEligible ? catCandidates : [];

  // ── Sort the combined set, then slice to the page limit ──────────────
  const combined: Ranked[] = [...drugResults, ...catResults];
  if (sort === "resolution") {
    combined.sort((a, b) =>
      a._res === b._res ? 0 : a._res === null ? 1 : b._res === null ? -1 : a._res - b._res
    );
  } else if (sort === "severity") {
    combined.sort((a, b) => b._sev - a._sev);
  }

  const total = combined.length;
  const results: SearchHit[] = combined
    .slice(0, limit)
    .map(({ _res, _sev, ...rest }) => { void _res; void _sev; return rest; });

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
    {
      query: q,
      results,
      total,
      market: isGlobal ? "ALL" : market,
      sort,
      status: [...statusKeys],
      facets: { status: facetStatus },
    },
    { headers: timer.headers() }
  );
}
