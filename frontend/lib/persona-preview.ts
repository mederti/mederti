// Shared helper for persona landing pages: pulls 5 real shortage rows from
// Supabase to render in the PersonaPage preview block.
//
// Closes audit FINDING-UX-09 — previously each persona landing showed a
// hardcoded fake 5-row "preview" (Amoxicillin/Paracetamol/Metformin/...)
// that demonstrated the product looked like a static mockup. This helper
// returns the same shape but populated from live shortage_events data.
//
// Falls back to the persona page's hardcoded rows on any error so the
// page still renders even if Supabase is unreachable.

import { getSupabaseAdminTyped } from "@/lib/supabase/admin";

export type PreviewRow = {
  label: string;
  badge: string;
  badgeColor: string;
  badgeBg: string;
};

const SEVERITY_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };

const BADGE_STYLE: Record<string, { color: string; bg: string; label: string }> = {
  critical: { color: "var(--crit)", bg: "var(--crit-bg)", label: "Critical" },
  high:     { color: "var(--high)", bg: "var(--high-bg)", label: "High" },
  medium:   { color: "var(--med)",  bg: "var(--med-bg)",  label: "Medium" },
  low:      { color: "var(--low)",  bg: "var(--low-bg)",  label: "Low" },
};

/**
 * Returns up to 5 active shortage rows for the persona preview block.
 * Prefers severity-diversity so the preview shows a mix (one critical,
 * one high, etc.) rather than 5 of the same colour.
 *
 * Always returns either 5 rows or null (on error). Never throws — the
 * persona page falls back to its hardcoded `previewRows` when null.
 */
export async function getLivePreviewRows(opts: {
  countryCode?: string;
} = {}): Promise<PreviewRow[] | null> {
  try {
    const sb = getSupabaseAdminTyped();

    let q = sb
      .from("shortage_events")
      .select("severity, drugs(generic_name, strengths)")
      .eq("status", "active")
      .not("severity", "is", null);

    if (opts.countryCode) {
      q = q.eq("country_code", opts.countryCode.toUpperCase());
    }

    // Pull a wide cut, then diversify by severity in JS. Cheaper than 4
    // separate severity-pinned queries.
    const { data, error } = await q.order("last_verified_at", { ascending: false }).limit(40);
    if (error || !data) return null;

    // Group by severity, take the first 1-2 from each bucket.
    type Row = { severity: string | null; drugs: { generic_name: string | null; strengths: string[] | null } | null };
    const rows = data as unknown as Row[];

    const buckets: Record<string, Row[]> = { critical: [], high: [], medium: [], low: [] };
    for (const r of rows) {
      const s = r.severity ?? "";
      if (s in buckets) buckets[s].push(r);
    }

    // 2 critical + 1 high + 1 medium + 1 low, falling back to next-most-severe
    // if a bucket is empty.
    const pickPlan = ["critical", "critical", "high", "medium", "low"];
    const picked: Row[] = [];
    const seenLabels = new Set<string>();
    const allBucketsInRankOrder = ["critical", "high", "medium", "low"];

    for (const wanted of pickPlan) {
      let chosen: Row | undefined;
      // Try the wanted severity first, then fall back to any non-empty bucket
      // with a label we haven't shown yet.
      const order = [wanted, ...allBucketsInRankOrder.filter((s) => s !== wanted)];
      for (const sev of order) {
        const candidate = buckets[sev]?.find((r) => {
          const name = r.drugs?.generic_name ?? "";
          return name && !seenLabels.has(name.toLowerCase());
        });
        if (candidate) {
          chosen = candidate;
          break;
        }
      }
      if (!chosen) continue;
      seenLabels.add((chosen.drugs?.generic_name ?? "").toLowerCase());
      picked.push(chosen);
      if (picked.length >= 5) break;
    }

    if (picked.length === 0) return null;

    return picked.map((r) => {
      const name = r.drugs?.generic_name ?? "Unknown";
      const strength = r.drugs?.strengths?.[0] ?? "";
      const sev = r.severity ?? "low";
      const style = BADGE_STYLE[sev] ?? BADGE_STYLE.low;
      return {
        label: strength ? `${name} ${strength}` : name,
        badge: style.label,
        badgeColor: style.color,
        badgeBg: style.bg,
      };
    });
  } catch {
    return null;
  }
}
