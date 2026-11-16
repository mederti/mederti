import { unstable_cache } from "next/cache";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { allRegulators, realEventsFilter } from "@/lib/pseo";
import { COUNTRY_NAMES, countryName, countrySlug } from "@/lib/geo/country-names";

/**
 * Per-country headline counts for the Countries map (/insights/countries).
 *
 * Every figure uses the SAME filters as countrySummary() in lib/pseo.ts —
 * country_code + status, synthetic rows excluded — so a number on the map
 * always equals the number on the country page it links to. Don't "optimise"
 * this into a different query shape without keeping that equality.
 *
 * A count is `null` when its query failed. Callers must render that as
 * "unavailable", never as 0: a zero here is a claim about the register.
 */
export interface CountryOverviewRow {
  code: string;
  name: string;
  slug: string;
  /** Sources whose shortage notices are behind this country's figures. */
  regulators: string[];
  /** False when no source for this country has ever supplied a notice. */
  everReceived: boolean;
  /** Open shortage notices (status = active). Notices, not medicines. */
  active: number | null;
  /** Active notices the regulator rates critical. */
  critical: number | null;
  /** Notices the regulator has announced but that have not started. */
  anticipated: number | null;
}

export interface CountriesOverview {
  rows: CountryOverviewRow[];
  generatedAt: string;
}

const BATCH = 8;

async function build(): Promise<CountriesOverview> {
  const admin = getSupabaseAdmin();
  const regs = await allRegulators();

  // One entry per active data_sources row in a mapped country. data_sources
  // has no "kind" column and also holds recall, pricing and approval feeds
  // (NADAC, NHS-BSA, "FDA Recalls"…), so which of these are shortage sources
  // is decided below from the notices themselves, not from the catalogue.
  type Src = { id: string; code: string; label: string };
  const sources: Src[] = [];
  for (const r of regs) {
    if (!r.is_active || !r.country_code) continue;
    const code = r.country_code.toUpperCase();
    // EU is a bloc-wide feed, not a country polygon.
    if (code === "EU" || !COUNTRY_NAMES[code]) continue;
    sources.push({ id: r.id, code, label: r.abbreviation ?? r.name });
  }

  // Notices held per source: open (active/anticipated) and ever. Synthetic
  // rows excluded, same as every other figure here.
  const sourceCount = async (id: string, openOnly: boolean): Promise<number | null> => {
    try {
      let q = admin
        .from("shortage_events")
        .select("id", { count: "exact", head: true })
        .eq("data_source_id", id);
      if (openOnly) q = q.in("status", ["active", "anticipated"]);
      const { count: n, error } = await realEventsFilter(q);
      return error ? null : n ?? null;
    } catch {
      return null;
    }
  };
  const held = new Map<string, { open: number | null; ever: number | null }>();
  for (let i = 0; i < sources.length; i += BATCH) {
    await Promise.all(
      sources.slice(i, i + BATCH).map(async (s) => {
        const [open, ever] = await Promise.all([sourceCount(s.id, true), sourceCount(s.id, false)]);
        held.set(s.id, { open, ever });
      }),
    );
  }

  // Name the sources whose notices are behind the country's figures: those
  // with open notices, else those that have ever supplied one. A country
  // whose sources have never supplied a notice gets an empty list.
  const byCode = new Map<string, string[]>();
  for (const code of new Set(sources.map((s) => s.code))) {
    const mine = sources.filter((s) => s.code === code);
    const withOpen = mine.filter((s) => (held.get(s.id)?.open ?? 0) > 0);
    const withAny = mine.filter((s) => (held.get(s.id)?.ever ?? 0) > 0);
    const pick = withOpen.length ? withOpen : withAny;
    byCode.set(code, Array.from(new Set(pick.map((s) => s.label))));
  }
  const everByCode = new Map<string, boolean>();
  for (const s of sources) {
    if ((held.get(s.id)?.ever ?? 0) > 0) everByCode.set(s.code, true);
  }

  const count = async (code: string, extra: Record<string, string>): Promise<number | null> => {
    try {
      let q = admin
        .from("shortage_events")
        .select("id", { count: "exact", head: true })
        .eq("country_code", code);
      for (const [k, v] of Object.entries(extra)) q = q.eq(k, v);
      const { count: n, error } = await realEventsFilter(q);
      return error ? null : n ?? null;
    } catch {
      return null;
    }
  };

  const codes = Array.from(byCode.keys());
  const rows: CountryOverviewRow[] = [];
  for (let i = 0; i < codes.length; i += BATCH) {
    const batch = await Promise.all(
      codes.slice(i, i + BATCH).map(async (code) => {
        const [active, critical, anticipated] = await Promise.all([
          count(code, { status: "active" }),
          count(code, { status: "active", severity: "critical" }),
          count(code, { status: "anticipated" }),
        ]);
        return {
          code,
          name: countryName(code),
          slug: countrySlug(code),
          regulators: byCode.get(code) ?? [],
          everReceived: everByCode.get(code) ?? false,
          active,
          critical,
          anticipated,
        };
      }),
    );
    rows.push(...batch);
  }

  rows.sort((a, b) => (b.active ?? -1) - (a.active ?? -1) || a.name.localeCompare(b.name));
  return { rows, generatedAt: new Date().toISOString() };
}

/** Cached for an hour — the same cadence the country pages revalidate at. */
export const countriesOverview = unstable_cache(build, ["countries-overview-v3"], {
  revalidate: 3600,
});
