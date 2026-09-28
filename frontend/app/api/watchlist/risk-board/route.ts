import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { RiskTier, RiskItem } from "@/lib/watchlist-risk";

// Watchlist risk board (hospital-pharmacist feedback #5). The national
// dashboard is broad and noisy; a pharmacist wants THEIR products, tiered by
// forward risk, so planning happens before a shortage bites.
//
// POST { drug_ids: string[], country: string }  →  each watched drug bucketed:
//   short_now     — active shortage in the user's market right now
//   anticipated   — a declared anticipated shortage, flagged imminent when its
//                   anticipated start is within 60 days (or has no date yet)
//   early_warning — not short locally, but short in ≥2 peer markets (the
//                   strongest leading indicator of an upstream failure that
//                   hasn't reached the user's market yet)
//   watching      — none of the above; on the list, currently quiet
//
// The watchlist is read client-side (RLS-guarded browser session) and the ids
// are POSTed here, so this route stays a pure, cacheable aggregation over a
// SMALL id set — no full-table scan, unlike /api/predictive-signals.

export const dynamic = "force-dynamic";

// Compact peer sets (mirror /api/predictive-signals). Peer breadth is the
// leading signal for a not-yet-local shortage.
const PEER_GROUPS: Record<string, string[]> = {
  GB: ["IE", "IT", "DE", "FR", "ES", "BE", "NL", "PT", "GR", "AT", "CH", "FI", "NO", "SE", "DK", "EU"],
  IE: ["GB", "IT", "DE", "FR", "ES", "BE", "NL", "PT", "AT", "CH", "FI", "NO", "SE", "DK", "EU"],
  AU: ["NZ", "GB", "US", "CA", "SG"],
  NZ: ["AU", "GB", "US", "CA", "SG"],
  CA: ["US", "GB", "EU", "FR", "DE", "AU"],
  US: ["CA", "GB", "EU", "FR", "DE"],
  IT: ["DE", "FR", "ES", "BE", "NL", "IE", "PT", "GR", "AT", "CH", "FI", "NO", "SE", "DK", "GB", "EU"],
  DE: ["IT", "FR", "ES", "BE", "NL", "IE", "PT", "GR", "AT", "CH", "FI", "NO", "SE", "DK", "GB", "EU"],
  FR: ["IT", "DE", "ES", "BE", "NL", "IE", "PT", "GR", "AT", "CH", "FI", "NO", "SE", "DK", "GB", "EU"],
  ES: ["IT", "DE", "FR", "BE", "NL", "IE", "PT", "GR", "AT", "CH", "FI", "NO", "SE", "DK", "GB", "EU"],
};

const SEV_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
const IMMINENT_DAYS = 60;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Ev = {
  drug_id: string;
  country_code: string | null;
  status: string | null;
  severity: string | null;
  anticipated_start_date: string | null;
  estimated_resolution_date: string | null;
};

export async function POST(req: Request) {
  let body: { drug_ids?: unknown; country?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const country = String(body.country ?? "AU").toUpperCase().slice(0, 3);
  const ids = Array.isArray(body.drug_ids)
    ? [...new Set(body.drug_ids.filter((x): x is string => typeof x === "string" && UUID_RE.test(x)))].slice(0, 200)
    : [];

  if (ids.length === 0) {
    return NextResponse.json({ country, counts: emptyCounts(), items: [] });
  }

  const sb = getSupabaseAdmin();
  const peers = new Set(PEER_GROUPS[country] ?? []);

  // Active + anticipated events for exactly these drugs (small id set → cheap,
  // indexed by drug_id). Resolved events are irrelevant to forward risk.
  const [{ data: evData }, { data: drugData }] = await Promise.all([
    sb
      .from("shortage_events")
      .select("drug_id, country_code, status, severity, anticipated_start_date, estimated_resolution_date")
      .in("drug_id", ids)
      .in("status", ["active", "anticipated"]),
    sb
      .from("drugs")
      .select("id, generic_name, who_essential_medicine")
      .in("id", ids),
  ]);

  const nameMap = new Map<string, { name: string; who: boolean }>();
  for (const d of (drugData ?? []) as Array<{ id: string; generic_name: string; who_essential_medicine: boolean }>) {
    nameMap.set(d.id, { name: d.generic_name, who: !!d.who_essential_medicine });
  }

  // Fold events per drug.
  const agg = new Map<string, {
    localActive: Ev[]; localAnticipated: Ev[]; peerActive: Map<string, number>;
  }>();
  for (const id of ids) agg.set(id, { localActive: [], localAnticipated: [], peerActive: new Map() });

  for (const ev of (evData ?? []) as Ev[]) {
    const a = agg.get(ev.drug_id);
    if (!a) continue;
    const cc = (ev.country_code ?? "").toUpperCase();
    const status = (ev.status ?? "").toLowerCase();
    if (cc === country) {
      if (status === "active") a.localActive.push(ev);
      else if (status === "anticipated") a.localAnticipated.push(ev);
    } else if (status === "active" && peers.has(cc)) {
      a.peerActive.set(cc, (a.peerActive.get(cc) ?? 0) + 1);
    }
  }

  const today = new Date();
  const daysBetween = (iso: string | null): number | null => {
    if (!iso) return null;
    const t = new Date(iso).getTime();
    if (Number.isNaN(t)) return null;
    return Math.round((t - today.getTime()) / 86400000);
  };
  const worstSev = (evs: Ev[]): string | null => {
    let best: string | null = null;
    for (const e of evs) {
      if ((SEV_RANK[(e.severity ?? "").toLowerCase()] ?? 0) > (SEV_RANK[(best ?? "").toLowerCase()] ?? 0)) {
        best = e.severity;
      }
    }
    return best;
  };
  const earliest = (evs: Ev[], key: "estimated_resolution_date" | "anticipated_start_date"): string | null => {
    let best: string | null = null;
    for (const e of evs) {
      const v = e[key];
      if (v && (!best || v < best)) best = v;
    }
    return best;
  };

  const items: RiskItem[] = ids.map((id) => {
    const a = agg.get(id)!;
    const meta = nameMap.get(id) ?? { name: "Unknown medicine", who: false };
    const peerList = [...a.peerActive.keys()].sort();

    let tier: RiskTier;
    if (a.localActive.length > 0) tier = "short_now";
    else if (a.localAnticipated.length > 0) tier = "anticipated";
    else if (peerList.length >= 2) tier = "early_warning";
    else tier = "watching";

    const anticipatedStart = earliest(a.localAnticipated, "anticipated_start_date");
    return {
      drug_id: id,
      name: meta.name,
      who_essential: meta.who,
      tier,
      severity:
        tier === "short_now" ? worstSev(a.localActive)
          : tier === "anticipated" ? worstSev(a.localAnticipated)
            : null,
      est_return: earliest(a.localActive, "estimated_resolution_date"),
      anticipated_start: anticipatedStart,
      days_until: daysBetween(anticipatedStart),
      peer_count: peerList.length,
      peers: peerList,
    };
  });

  // Rank: worst tier first; within a tier, WHO-essential + severity + peer breadth.
  const TIER_RANK: Record<RiskTier, number> = { short_now: 3, anticipated: 2, early_warning: 1, watching: 0 };
  items.sort((x, y) =>
    TIER_RANK[y.tier] - TIER_RANK[x.tier] ||
    Number(y.who_essential) - Number(x.who_essential) ||
    (SEV_RANK[(y.severity ?? "").toLowerCase()] ?? 0) - (SEV_RANK[(x.severity ?? "").toLowerCase()] ?? 0) ||
    y.peer_count - x.peer_count ||
    x.name.localeCompare(y.name),
  );

  const counts = emptyCounts();
  for (const it of items) counts[it.tier]++;

  // Flag anticipated items whose start is inside the planning window.
  const imminent = items.filter(
    (i) => i.tier === "anticipated" && i.days_until != null && i.days_until <= IMMINENT_DAYS,
  ).length;

  return NextResponse.json({
    country,
    imminent_window_days: IMMINENT_DAYS,
    imminent,
    counts,
    items,
  });
}

function emptyCounts(): Record<RiskTier, number> {
  return { short_now: 0, anticipated: 0, early_warning: 0, watching: 0 };
}
