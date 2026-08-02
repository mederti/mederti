import type { Metadata } from "next";
import Link from "next/link";
import SiteNav from "@/app/components/landing-nav";
import MinimalFooter from "@/app/components/minimal-footer";
import { jsonLdSafe, breadcrumbJsonLd } from "@/lib/seo";
import { allRegulators } from "@/lib/pseo";
import { countryName, countrySlug, COUNTRY_NAMES } from "@/lib/geo/country-names";

// Hub page linking to every /country/[slug]/medicine-shortages page.
// Country list comes from data_sources (one row per regulator we scrape), so
// it stays in sync with real coverage without a hardcoded list drifting.
export const revalidate = 21600;

export const metadata: Metadata = {
  title: "Medicine shortages by country — 50+ national registers | Mederti",
  description:
    "Live medicine shortage registers for 50+ countries, aggregated daily from each country's official medicines regulator. Pick a country to see its current shortages.",
  alternates: { canonical: "/country" },
};

export default async function CountryHubPage() {
  let codes: string[] = [];
  try {
    const regs = await allRegulators();
    codes = Array.from(
      new Set(regs.filter((r) => r.is_active).map((r) => r.country_code)),
    ).filter((c) => COUNTRY_NAMES[c]);
  } catch {
    codes = [];
  }
  if (codes.length === 0) codes = Object.keys(COUNTRY_NAMES);
  codes.sort((a, b) => countryName(a).localeCompare(countryName(b)));

  const crumbs = breadcrumbJsonLd([
    { name: "Home", path: "/" },
    { name: "Countries", path: "/country" },
  ]);

  return (
    <div style={{ background: "#fff", minHeight: "100vh", color: "var(--app-text)", fontFamily: "var(--font-geist-sans), sans-serif" }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdSafe(crumbs) }} />
      <SiteNav />

      <main style={{ maxWidth: 860, margin: "0 auto", padding: "48px 24px 80px" }}>
        <h1 style={{ fontSize: 34, fontWeight: 700, letterSpacing: "-0.03em", margin: "0 0 10px" }}>
          Medicine shortages, by country
        </h1>
        <p style={{ fontSize: 15, color: "var(--app-text-2)", lineHeight: 1.7, margin: "0 0 8px", maxWidth: 640 }}>
          Mederti aggregates each country&apos;s official shortage register daily — one place instead
          of dozens of regulator websites in a dozen languages. Choose a country for its live list.
        </p>
        <p style={{ fontSize: 13, color: "var(--app-text-3)", margin: "0 0 28px" }}>
          Or browse by <Link href="/medicine" style={{ color: "var(--teal, #0fa676)" }}>medicine</Link> or{" "}
          <Link href="/regulator" style={{ color: "var(--teal, #0fa676)" }}>regulator</Link>.
        </p>

        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10 }}>
          {codes.map((code) => (
            <li key={code} style={{ border: "1px solid var(--app-border)", borderRadius: 10 }}>
              <Link
                href={`/country/${countrySlug(code)}/medicine-shortages`}
                style={{ display: "block", padding: "12px 14px", textDecoration: "none", color: "var(--app-text)", fontSize: 14, fontWeight: 500 }}
              >
                {countryName(code)}
              </Link>
            </li>
          ))}
        </ul>
      </main>

      <MinimalFooter />
    </div>
  );
}
