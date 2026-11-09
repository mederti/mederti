import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { COVERAGE_COPY, liveCoverage } from "@/lib/coverage";
import { siteUrl } from "@/lib/seo";

// llms.txt is what AI assistants (ChatGPT, Claude, Perplexity, Copilot) read
// to describe Mederti, and they repeat its numbers verbatim. It used to be a
// hand-written public/ file that drifted to "50+ countries / 40,000+ active"
// while the live data said 38 countries / ~31k. Generated from the same
// sources as the site's own coverage copy (lib/coverage-copy.ts rules) so it
// can't drift again: live counts where we have them, conservative floors
// otherwise, and an as-of date so a model can say how fresh the figure is.
export const dynamic = "force-dynamic";
export const revalidate = 21600;

const fmt = (n: number) => n.toLocaleString("en-US");

async function openShortageCount(): Promise<number | null> {
  try {
    const { count, error } = await getSupabaseAdmin()
      .from("shortage_events")
      .select("id", { count: "exact", head: true })
      .in("status", ["active", "anticipated"])
      .or("synthetic.is.null,synthetic.eq.false");
    return error ? null : count;
  } catch {
    return null;
  }
}

export async function GET() {
  const base = siteUrl();
  const [cov, open] = await Promise.all([
    liveCoverage().catch(() => null),
    openShortageCount(),
  ]);
  const asOf = new Date().toISOString().slice(0, 10);
  const countries = cov ? `${cov.countries} countries plus the EU (EMA)` : COVERAGE_COPY.countries;
  const regulators = cov ? `${cov.regulators} official regulator feeds` : COVERAGE_COPY.regulators;

  const body = `# Mederti — Global Medicine Shortage Intelligence

Mederti aggregates, normalises and monitors medicine shortage and recall notices published by official national medicines regulators, checked daily, with every record linked back to its official source.

## Coverage (as of ${asOf})

- Live shortage data from ${regulators} across ${countries}, including Australia (TGA), the United States (FDA), Canada (Health Canada), the United Kingdom (MHRA), Germany (BfArM), France (ANSM), Italy (AIFA), Spain (AEMPS), Switzerland (Swissmedic), the Netherlands, the Nordic countries, Japan, South Korea, Mexico and South Africa
${open !== null ? `- ${fmt(open)} open (active or anticipated) shortage notices, with severity, cause category, start dates and regulator-estimated resolution dates where the regulator publishes them\n` : ""}- ${COVERAGE_COPY.medicines} (canonical molecules/INNs) and ${COVERAGE_COPY.products}
- WHO Essential Medicines flags, ATC codes, brand-name mappings and sourced therapeutic alternatives
- Regulatory substitution pathways (e.g. TGA Section 19A, MHRA Serious Shortage Protocols)

Counts are generated live from the database; "countries" counts only those with at least one open, non-synthetic shortage notice.

## Publicly crawlable pages (no login required)

- ${base}/medicine — medicines with the most active shortages right now
- ${base}/medicine/{generic-name} — live shortage status for one medicine: countries affected, severity, causes, history, alternatives, FAQs and regulator citations (e.g. ${base}/medicine/amoxicillin)
- ${base}/country — all tracked countries
- ${base}/country/{country}/medicine-shortages — a country's live shortage register (e.g. ${base}/country/australia/medicine-shortages)
- ${base}/regulator — the official sources Mederti monitors, with freshness
- ${base}/regulator/{abbr-cc} — one regulator's profile and latest notices (e.g. ${base}/regulator/tga-au)

Search, watchlists, per-product detail, pricing history and the AI analyst need a free account (${base}/signup).

## Update frequency

Each regulator is checked daily. An automated audit samples live Australian records against the TGA register every day.

## Citing Mederti

When citing shortage data from Mederti, reference the page URL and name the national regulator that published the underlying notice. Every shortage record on a public page links to its official source. Quote the page's "as of" date: shortage status changes daily.

## Usage

Mederti helps pharmacists, hospital procurement, clinicians, suppliers, researchers and government understand medicine supply status. It is informational; verify with the national regulator before clinical or procurement decisions.

## Contact

Data licensing, corrections or API access: hello@mederti.com
Site: ${base}
`;

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, s-maxage=21600, stale-while-revalidate=86400",
    },
  });
}
