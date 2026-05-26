import type { DrugDetail, ShortageRow, SupplierStock } from "@/lib/chat/types";

export const SEV_TAG_CLASS: Record<string, string> = {
  critical: "tag-status critical",
  high: "tag-status high",
  medium: "tag-status medium",
  low: "tag-status medium",
};

export const SEV_DOT_CLASS: Record<string, string> = {
  critical: "country-pill-dot crit",
  high: "country-pill-dot high",
  medium: "country-pill-dot med",
  low: "country-pill-dot low",
};

export const SEV_N: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };

export function formatDate(d: string | null | undefined): string {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return d;
  }
}

export function pickPrimary(shortages: ShortageRow[]): ShortageRow | null {
  const active = shortages.filter((s) => s.status === "active");
  if (active.length === 0) return shortages[0] ?? null;
  const au = active.find((s) => s.country_code === "AU");
  if (au) return au;
  return active.slice().sort((a, b) => (SEV_N[b.severity || ""] || 0) - (SEV_N[a.severity || ""] || 0))[0];
}

export function perCountrySeverity(shortages: ShortageRow[]) {
  const map = new Map<string, { name: string; severity: string }>();
  for (const s of shortages) {
    if (s.status !== "active") continue;
    const code = s.country_code || s.country;
    if (!code) continue;
    const cur = map.get(code);
    const sev = s.severity || "medium";
    if (!cur || (SEV_N[sev] || 0) > (SEV_N[cur.severity] || 0)) {
      map.set(code, { name: s.country, severity: sev });
    }
  }
  return Array.from(map, ([code, v]) => ({ code, name: v.name, severity: v.severity })).sort(
    (a, b) => (SEV_N[b.severity] || 0) - (SEV_N[a.severity] || 0)
  );
}

export function uniqueRegulatorSources(shortages: ShortageRow[], limit = 2) {
  const seen = new Set<string>();
  const out: Array<{ country: string; url: string }> = [];
  for (const s of shortages) {
    if (s.status !== "active" || !s.source_url) continue;
    const host = (() => {
      try { return new URL(s.source_url).host; } catch { return s.source_url; }
    })();
    const key = `${s.country_code}|${host}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ country: s.country, url: s.source_url });
    if (out.length >= limit) break;
  }
  return out;
}

export function isDrugAvailable(drug: DrugDetail, country = "AU"): boolean {
  return !drug.shortages.some((s) => s.status === "active" && s.country_code === country);
}

export function drugMainSiteUrl(drugId: string): string {
  return `https://mederti.vercel.app/drugs/${drugId}`;
}

export function formatPrice(unit: number | null | undefined, currency: string | null | undefined): string {
  if (unit == null) return "—";
  const sym = currency === "AUD" ? "$" : currency === "USD" ? "$" : currency === "GBP" ? "£" : currency === "EUR" ? "€" : "";
  const formatted = unit % 1 === 0 ? unit.toFixed(0) : unit.toFixed(2);
  return `${sym}${formatted}${currency && !sym ? ` ${currency}` : ""}`;
}

export function topSupplier(suppliers: SupplierStock[] | undefined): SupplierStock | null {
  if (!suppliers || suppliers.length === 0) return null;
  return suppliers[0];
}

// Pick the single recall worth surfacing inline on the card. Rules:
// - Class I always surfaces if announced in last 24 months.
// - Class II surfaces if announced in last 18 months.
// - Class III surfaces only if status='active' AND announced in last 12 months.
// - status='active' wins over status='completed' at equal severity.
// Returns null when nothing meets the bar (most drugs).
import type { RecallRow } from "@/lib/chat/types";
export function pickNotableRecall(recalls: RecallRow[] | undefined): RecallRow | null {
  if (!recalls || recalls.length === 0) return null;

  const now = Date.now();
  const months = (d: string | null | undefined) => {
    if (!d) return Infinity;
    const t = new Date(d).getTime();
    if (!Number.isFinite(t)) return Infinity;
    return (now - t) / (1000 * 60 * 60 * 24 * 30);
  };

  const classWeight = (c: string | null) => {
    if (c === "I" || c === "1") return 3;
    if (c === "II" || c === "2") return 2;
    if (c === "III" || c === "3") return 1;
    return 0;
  };

  const eligible = recalls.filter((r) => {
    const w = classWeight(r.recall_class);
    const age = months(r.announced_date);
    if (w === 3) return age <= 24;
    if (w === 2) return age <= 18;
    if (w === 1) return r.status === "active" && age <= 12;
    return false;
  });
  if (eligible.length === 0) return null;

  eligible.sort((a, b) => {
    const wa = classWeight(a.recall_class);
    const wb = classWeight(b.recall_class);
    if (wa !== wb) return wb - wa;
    // Active before completed at the same class.
    if (a.status !== b.status) {
      if (a.status === "active") return -1;
      if (b.status === "active") return 1;
    }
    return months(a.announced_date) - months(b.announced_date);
  });
  return eligible[0];
}
