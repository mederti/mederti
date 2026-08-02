import type { Metadata } from "next";
import Link from "next/link";
import SiteNav from "@/app/components/landing-nav";
import MinimalFooter from "@/app/components/minimal-footer";
import { jsonLdSafe, breadcrumbJsonLd } from "@/lib/seo";
import { allRegulators, regulatorSlug } from "@/lib/pseo";
import { countryName } from "@/lib/geo/country-names";

// Hub page linking to every /regulator/[slug] profile. The source catalogue
// is itself a trust signal: every shortage record cites one of these.
export const revalidate = 21600;

export const metadata: Metadata = {
  title: "Medicines regulators Mederti tracks — 40+ official sources | Mederti",
  description:
    "The official medicines regulators behind Mederti's shortage data — FDA, TGA, MHRA, EMA and 40+ more — with each source's register, cadence and latest notices.",
  alternates: { canonical: "/regulator" },
};

export default async function RegulatorHubPage() {
  let regs: Awaited<ReturnType<typeof allRegulators>> = [];
  try {
    regs = (await allRegulators()).filter((r) => r.is_active);
  } catch {
    regs = [];
  }
  regs.sort((a, b) => countryName(a.country_code).localeCompare(countryName(b.country_code)));

  const crumbs = breadcrumbJsonLd([
    { name: "Home", path: "/" },
    { name: "Regulators", path: "/regulator" },
  ]);

  return (
    <div style={{ background: "#fff", minHeight: "100vh", color: "var(--app-text)", fontFamily: "var(--font-geist-sans), sans-serif" }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdSafe(crumbs) }} />
      <SiteNav />

      <main style={{ maxWidth: 860, margin: "0 auto", padding: "48px 24px 80px" }}>
        <h1 style={{ fontSize: 34, fontWeight: 700, letterSpacing: "-0.03em", margin: "0 0 10px" }}>
          The regulators behind the data
        </h1>
        <p style={{ fontSize: 15, color: "var(--app-text-2)", lineHeight: 1.7, margin: "0 0 8px", maxWidth: 640 }}>
          Every shortage record on Mederti is sourced from an official national medicines regulator
          and linked back to the original notice. These are the sources we check.
        </p>
        <p style={{ fontSize: 13, color: "var(--app-text-3)", margin: "0 0 28px" }}>
          Browse by <Link href="/medicine" style={{ color: "var(--teal, #0fa676)" }}>medicine</Link> or{" "}
          <Link href="/country" style={{ color: "var(--teal, #0fa676)" }}>country</Link>.
        </p>

        {regs.length > 0 ? (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 10 }}>
            {regs.map((r) => (
              <li key={r.id} style={{ border: "1px solid var(--app-border)", borderRadius: 10 }}>
                <Link
                  href={`/regulator/${regulatorSlug(r)}`}
                  style={{ display: "block", padding: "12px 14px", textDecoration: "none", color: "var(--app-text)" }}
                >
                  <span style={{ fontSize: 14, fontWeight: 600, display: "block" }}>{r.abbreviation}</span>
                  <span style={{ fontSize: 12, color: "var(--app-text-3)" }}>
                    {r.name} · {countryName(r.country_code)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p style={{ fontSize: 14, color: "var(--app-text-3)" }}>
            The source list is temporarily unavailable — try again shortly.
          </p>
        )}
      </main>

      <MinimalFooter />
    </div>
  );
}
