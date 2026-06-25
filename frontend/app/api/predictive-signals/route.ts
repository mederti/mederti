import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

// 10-min cache. The 30k-row aggregation is expensive (audit FINDING-P5-02)
// and the underlying shortage_events table is updated by scrapers running
// every 4h+. Per-?country variant caches separately. Closes part of
// audit FINDING-P5-01.
export const revalidate = 600;

/**
 * GET /api/predictive-signals?country=GB
 *
 * Returns drugs in shortage across multiple peer markets but not yet in the
 * user's country. The cross-country count is the strongest leading indicator
 * for upstream API/finished-product failure that has not yet reached the
 * user's market.
 *
 * For GB the peer set is the EU+UK orbit. For US the peer set is North
 * America + EU. For each entry we list which peers are short, the worst
 * severity across them, and how many days the oldest of those shortages
 * has been open.
 */

const PEER_GROUPS: Record<string, string[]> = {
  GB: ["IT", "DE", "FR", "ES", "BE", "NL", "IE", "PT", "GR", "AT", "CH", "FI", "NO", "SE", "DK", "EU"],
  IE: ["GB", "IT", "DE", "FR", "ES", "BE", "NL", "PT", "GR", "AT", "CH", "FI", "NO", "SE", "DK", "EU"],
  AU: ["NZ", "GB", "US", "CA", "SG"],
  NZ: ["AU", "GB", "US", "CA", "SG"],
  CA: ["US", "GB", "EU", "FR", "DE", "AU"],
  US: ["CA", "GB", "EU", "FR", "DE"],
  // EU and individual European markets default to the European set
  IT: ["DE", "FR", "ES", "BE", "NL", "IE", "PT", "GR", "AT", "CH", "FI", "NO", "SE", "DK", "GB", "EU"],
  DE: ["IT", "FR", "ES", "BE", "NL", "IE", "PT", "GR", "AT", "CH", "FI", "NO", "SE", "DK", "GB", "EU"],
  FR: ["IT", "DE", "ES", "BE", "NL", "IE", "PT", "GR", "AT", "CH", "FI", "NO", "SE", "DK", "GB", "EU"],
  ES: ["IT", "DE", "FR", "BE", "NL", "IE", "PT", "GR", "AT", "CH", "FI", "NO", "SE", "DK", "GB", "EU"],
};

const SEV_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };

// A price concession is "live" if granted within this window (covers the
// current + prior month given monthly publication + scrape lag).
const CONCESSION_ACTIVE_MS = 75 * 86400000;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const country = (url.searchParams.get("country") ?? "GB").toUpperCase();
  const minPeers = Number(url.searchParams.get("min_peers") ?? "3");
  const limit = Math.min(Number(url.searchParams.get("limit") ?? "20"), 100);

  const peers = PEER_GROUPS[country] ?? PEER_GROUPS.GB;
  const sb = getSupabaseAdmin();

  // Pull all active shortages — we need every event (worst-severity and oldest
  // start are computed across all markets, not just peers). PostgREST caps a
  // single response at 1000 rows, so we page; but a HEAD count tells us the page
  // count up front and we fire the pages concurrently instead of walking them
  // serially (was ~30 sequential round-trips on a 30k-row table → now one count
  // + one parallel fan-out). Closes part of audit FINDING-P5-01.
  type Ev = { drug_id: string; country_code: string; severity: string; start_date: string | null };
  const PAGE = 1000;
  const allEvents: Ev[] = [];
  const { count } = await sb
    .from("shortage_events")
    .select("drug_id", { count: "exact", head: true })
    .eq("status", "active");

  if (count != null) {
    const reqs = [];
    for (let off = 0; off < count; off += PAGE) {
      reqs.push(
        sb
          .from("shortage_events")
          .select("drug_id, country_code, severity, start_date")
          .eq("status", "active")
          .range(off, off + PAGE - 1),
      );
    }
    for (const p of await Promise.all(reqs)) {
      if (p.data) allEvents.push(...(p.data as Ev[]));
    }
  } else {
    // Count unavailable (e.g. transient error) → fall back to a serial drain so
    // the radar still populates rather than rendering empty.
    let offset = 0;
    while (true) {
      const { data } = await sb
        .from("shortage_events")
        .select("drug_id, country_code, severity, start_date")
        .eq("status", "active")
        .range(offset, offset + PAGE - 1);
      if (!data || data.length === 0) break;
      allEvents.push(...(data as Ev[]));
      if (data.length < PAGE) break;
      offset += PAGE;
    }
  }

  // Group by drug
  const drugMap = new Map<string, {
    countries: Set<string>;
    peerCountries: Set<string>;
    inUserCountry: boolean;
    worstSev: string;
    oldestStart: string | null;
  }>();
  for (const ev of allEvents) {
    if (!ev.drug_id) continue;
    if (!drugMap.has(ev.drug_id)) {
      drugMap.set(ev.drug_id, {
        countries: new Set(),
        peerCountries: new Set(),
        inUserCountry: false,
        worstSev: "low",
        oldestStart: null,
      });
    }
    const d = drugMap.get(ev.drug_id)!;
    d.countries.add(ev.country_code);
    if (ev.country_code === country) d.inUserCountry = true;
    if (peers.includes(ev.country_code)) d.peerCountries.add(ev.country_code);
    const r = SEV_RANK[ev.severity] ?? 0;
    if (r > (SEV_RANK[d.worstSev] ?? 0)) d.worstSev = ev.severity;
    if (ev.start_date && (!d.oldestStart || ev.start_date < d.oldestStart)) {
      d.oldestStart = ev.start_date;
    }
  }

  // Live price concessions by drug → which markets. A concession means a
  // regulator is paying above tariff because pharmacies can't source at price:
  // a supply-pressure signal that often LEADS the shortage listing. A
  // concession in the user's own market is the most imminent signal of all —
  // local price pressure ahead of a local shortage. GB-only today (NHS feed);
  // defensive so a missing table never breaks the radar.
  const concCutoff = new Date(Date.now() - CONCESSION_ACTIVE_MS).toISOString().slice(0, 10);
  const concByDrug = new Map<string, Set<string>>();
  try {
    const { data: concRows } = await sb
      .from("drug_pricing_history")
      .select("drug_id, country, effective_date")
      .eq("price_type", "concession")
      .gte("effective_date", concCutoff)
      .not("drug_id", "is", null);
    for (const r of (concRows ?? []) as Array<{ drug_id: string; country: string }>) {
      if (!concByDrug.has(r.drug_id)) concByDrug.set(r.drug_id, new Set());
      concByDrug.get(r.drug_id)!.add(r.country);
    }
  } catch { /* table not reachable → no concession signal, radar still works */ }

  // Filter: drugs short in `min_peers` peer markets but NOT in the user's —
  // OR with a live LOCAL concession backed by ≥1 peer shortage (local price
  // pressure is strong enough to admit a drug below the peer threshold).
  const candidates: Array<{
    drug_id: string;
    peer_count: number;
    peers: string[];
    worst_severity: string;
    oldest_start: string | null;
    days_lead: number | null;
    concession_local: boolean;
    concession_markets: string[];
  }> = [];

  for (const [drugId, d] of drugMap) {
    if (d.inUserCountry) continue;
    const concMarkets = concByDrug.get(drugId) ?? new Set<string>();
    const concessionLocal = concMarkets.has(country);
    const qualifies = d.peerCountries.size >= minPeers || (concessionLocal && d.peerCountries.size >= 1);
    if (!qualifies) continue;
    const days = d.oldestStart
      ? Math.floor((Date.now() - new Date(d.oldestStart).getTime()) / 86400000)
      : null;
    candidates.push({
      drug_id: drugId,
      peer_count: d.peerCountries.size,
      peers: [...d.peerCountries].sort(),
      worst_severity: d.worstSev,
      oldest_start: d.oldestStart,
      days_lead: days,
      concession_local: concessionLocal,
      concession_markets: [...concMarkets].sort(),
    });
  }

  // Composite rank: a live LOCAL concession dominates (most imminent), then
  // severity, then peer breadth + corroborating concession markets, then age.
  const score = (c: (typeof candidates)[number]): number =>
    (c.concession_local ? 1000 : 0) +
    (SEV_RANK[c.worst_severity] ?? 0) * 100 +
    c.peer_count * 5 +
    c.concession_markets.length * 3;
  candidates.sort((a, b) => {
    const d = score(b) - score(a);
    if (d !== 0) return d;
    return (b.days_lead ?? 0) - (a.days_lead ?? 0);
  });

  const top = candidates.slice(0, limit);
  const drugIds = top.map((c) => c.drug_id);
  const drugLookup = new Map<string, { generic_name: string; who_essential_medicine: boolean }>();
  if (drugIds.length > 0) {
    const { data: drugs } = await sb
      .from("drugs")
      .select("id, generic_name, who_essential_medicine")
      .in("id", drugIds);
    for (const d of drugs ?? []) {
      const r = d as { id: string; generic_name: string; who_essential_medicine: boolean };
      drugLookup.set(r.id, { generic_name: r.generic_name, who_essential_medicine: r.who_essential_medicine });
    }
  }

  const results = top.map((c) => {
    const meta = drugLookup.get(c.drug_id);
    return {
      ...c,
      drug_name: meta?.generic_name ?? "Unknown",
      who_essential: meta?.who_essential_medicine ?? false,
    };
  });

  return NextResponse.json({
    country,
    peer_set: peers,
    min_peers: minPeers,
    total_candidates: candidates.length,
    concession_candidates: candidates.filter((c) => c.concession_local).length,
    results,
  });
}
