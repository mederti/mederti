import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

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

export async function GET(req: Request) {
  const url = new URL(req.url);
  const country = (url.searchParams.get("country") ?? "GB").toUpperCase();
  const minPeers = Number(url.searchParams.get("min_peers") ?? "3");
  const limit = Math.min(Number(url.searchParams.get("limit") ?? "20"), 100);

  const peers = PEER_GROUPS[country] ?? PEER_GROUPS.GB;
  const sb = getSupabaseAdmin();

  // Pull all active shortages (paginated) — we need every event, not first 1000.
  const allEvents: Array<{ drug_id: string; country_code: string; severity: string; start_date: string | null }> = [];
  let offset = 0;
  while (true) {
    const { data } = await sb
      .from("shortage_events")
      .select("drug_id, country_code, severity, start_date")
      .eq("status", "active")
      .range(offset, offset + 999);
    if (!data || data.length === 0) break;
    allEvents.push(...(data as Array<{ drug_id: string; country_code: string; severity: string; start_date: string | null }>));
    if (data.length < 1000) break;
    offset += 1000;
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

  // Filter: drugs in `min_peers` peer countries but NOT in user's country
  const candidates: Array<{
    drug_id: string;
    peer_count: number;
    peers: string[];
    worst_severity: string;
    oldest_start: string | null;
    days_lead: number | null;
  }> = [];

  for (const [drugId, d] of drugMap) {
    if (d.inUserCountry) continue;
    if (d.peerCountries.size < minPeers) continue;
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
    });
  }

  // Rank by severity, peer count, oldest signal
  candidates.sort((a, b) => {
    const sa = SEV_RANK[a.worst_severity] ?? 0;
    const sb_ = SEV_RANK[b.worst_severity] ?? 0;
    if (sa !== sb_) return sb_ - sa;
    if (a.peer_count !== b.peer_count) return b.peer_count - a.peer_count;
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
    results,
  });
}
