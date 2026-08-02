import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import SiteNav from "@/app/components/landing-nav";
import MinimalFooter from "@/app/components/minimal-footer";
import {
  jsonLdSafe,
  breadcrumbJsonLd,
  faqJsonLd,
  datasetJsonLd,
  canonicalUrl,
} from "@/lib/seo";
import {
  countrySummary,
  allRegulators,
  regulatorSlug,
  slugify,
  fmtDate,
  type Faq,
} from "@/lib/pseo";
import { countryCodeFromSlug, countryName } from "@/lib/geo/country-names";

// Public programmatic SEO page: /country/[slug]/medicine-shortages
// (e.g. /country/australia/medicine-shortages). The per-country live register,
// refreshed hourly, with Dataset structured data for Google Dataset Search
// and AI retrieval.
export const revalidate = 3600;

const sevColor: Record<string, string> = {
  critical: "#b42318",
  high: "#b54708",
  medium: "#b58a00",
  low: "#0fa676",
};

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> },
): Promise<Metadata> {
  const { slug } = await params;
  const code = countryCodeFromSlug(slug);
  if (!code) return { title: "Country not found — Mederti", robots: { index: false } };
  const name = countryName(code);
  const title = `Medicine shortages in ${name} — live list & daily updates | Mederti`;
  const description = `Current drug shortages in ${name}: live register of active and anticipated shortage notices, severity, causes and official regulator sources. Updated daily.`;
  return {
    title,
    description,
    alternates: { canonical: `/country/${slug}/medicine-shortages` },
    openGraph: { title, description, url: canonicalUrl(`/country/${slug}/medicine-shortages`), type: "website" },
  };
}

export default async function CountryShortagesPage(
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const code = countryCodeFromSlug(slug);
  if (!code) notFound();

  const name = countryName(code);
  const [summary, regulators] = await Promise.all([
    countrySummary(code),
    allRegulators(),
  ]);
  const countryRegs = regulators.filter((r) => r.country_code === code && r.is_active);

  const faqs: Faq[] = [];
  if (summary.active !== null) {
    faqs.push({
      question: `How many medicines are in shortage in ${name}?`,
      answer: `${name} currently has ${summary.active} active medicine shortage notice${
        summary.active === 1 ? "" : "s"
      }${summary.anticipated ? ` and ${summary.anticipated} anticipated` : ""}${
        summary.critical ? `, of which ${summary.critical} are rated critical` : ""
      }. Figures update daily from official regulator publications.`,
    });
  }
  if (countryRegs.length > 0) {
    faqs.push({
      question: `Who reports medicine shortages in ${name}?`,
      answer: `Official shortage notices for ${name} are published by ${countryRegs
        .map((r) => `${r.name} (${r.abbreviation})`)
        .join(", ")}. Mederti checks ${countryRegs.length === 1 ? "this source" : "these sources"} daily and links every notice back to the original publication.`,
    });
  }
  faqs.push({
    question: `How current is this ${name} shortage data?`,
    answer: `Mederti scrapes ${name}'s official shortage register daily. Each notice carries the regulator's own dates; the list on this page reflects the most recent successful update.`,
  });

  const crumbs = breadcrumbJsonLd([
    { name: "Home", path: "/" },
    { name: "Countries", path: "/country" },
    { name: name, path: `/country/${slug}/medicine-shortages` },
  ]);
  const dataset = datasetJsonLd({
    name: `Medicine shortages in ${name} — live register`,
    description: `Active and anticipated drug shortage notices in ${name}, aggregated daily from official medicines regulators, with severity, cause categories, start dates and source links.`,
    path: `/country/${slug}/medicine-shortages`,
    temporalCoverage: "2024/..",
    spatialName: name,
    keywords: ["drug shortage", "medicine shortage", name, "pharmaceutical supply"],
  });

  const h2 = { fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em", margin: "40px 0 12px" } as const;
  const td = { padding: "10px 12px", fontSize: 14, borderTop: "1px solid var(--app-border)" } as const;
  const th = { padding: "10px 12px", fontSize: 12, textTransform: "uppercase" as const, letterSpacing: "0.05em", color: "var(--app-text-3)", textAlign: "left" as const };

  const stat = (label: string, value: number | null, color?: string) => (
    <div style={{ padding: "14px 18px", border: "1px solid var(--app-border)", borderRadius: 12, minWidth: 130 }}>
      <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-0.02em", color: color ?? "var(--app-text)" }}>
        {value === null ? "—" : value.toLocaleString()}
      </div>
      <div style={{ fontSize: 12, color: "var(--app-text-3)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
    </div>
  );

  return (
    <div style={{ background: "#fff", minHeight: "100vh", color: "var(--app-text)", fontFamily: "var(--font-geist-sans), sans-serif" }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdSafe(crumbs) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdSafe(dataset) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdSafe(faqJsonLd(faqs)) }} />
      <SiteNav />

      <main style={{ maxWidth: 800, margin: "0 auto", padding: "48px 24px 80px" }}>
        <nav aria-label="Breadcrumb" style={{ fontSize: 13, color: "var(--app-text-3)", marginBottom: 16 }}>
          <Link href="/" style={{ color: "inherit" }}>Home</Link>
          {" / "}
          <Link href="/country" style={{ color: "inherit" }}>Countries</Link>
          {" / "}
          <span>{name}</span>
        </nav>

        <h1 style={{ fontSize: 34, fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1.15, margin: "0 0 10px" }}>
          Medicine shortages in {name}
        </h1>
        <p style={{ fontSize: 15, color: "var(--app-text-2)", lineHeight: 1.7, margin: "0 0 24px", maxWidth: 640 }}>
          Live register of drug shortage notices in {name}, aggregated daily from official
          regulator publications and linked back to every source.
        </p>

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {stat("Active shortages", summary.active, "#b42318")}
          {stat("Anticipated", summary.anticipated, "#b54708")}
          {stat("Critical severity", summary.critical)}
        </div>

        {/* ── Recent notices ── */}
        {summary.recent.length > 0 && (
          <>
            <h2 style={h2}>Latest shortage notices in {name}</h2>
            <div style={{ overflowX: "auto", border: "1px solid var(--app-border)", borderRadius: 12 }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={th}>Medicine</th>
                    <th style={th}>Status</th>
                    <th style={th}>Severity</th>
                    <th style={th}>Since</th>
                    <th style={th}>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.recent.map((e) => (
                    <tr key={e.id}>
                      <td style={td}>
                        {e.drugs?.generic_name ? (
                          <Link href={`/medicine/${slugify(e.drugs.generic_name)}`} style={{ color: "var(--teal, #0fa676)", textDecoration: "none", fontWeight: 500 }}>
                            {e.drugs.generic_name}
                          </Link>
                        ) : (
                          <span style={{ color: "var(--app-text-2)" }}>Unlinked product</span>
                        )}
                      </td>
                      <td style={{ ...td, textTransform: "capitalize" }}>{e.status}</td>
                      <td style={td}>
                        {e.severity ? (
                          <span style={{ color: sevColor[e.severity] ?? "var(--app-text-2)", fontWeight: 600, textTransform: "capitalize" }}>{e.severity}</span>
                        ) : "—"}
                      </td>
                      <td style={td}>{fmtDate(e.start_date)}</td>
                      <td style={td}>
                        {e.source_url ? (
                          <a href={e.source_url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--app-text-2)" }}>
                            {e.data_sources?.abbreviation ?? e.data_sources?.name ?? "Source"}
                          </a>
                        ) : (
                          e.data_sources?.abbreviation ?? "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p style={{ fontSize: 13, color: "var(--app-text-3)", marginTop: 10 }}>
              Showing the {summary.recent.length} most recent of {summary.active ?? "all"} active notices.
              Sign up free to search, filter and export the full {name} register.
            </p>
          </>
        )}

        {/* ── Regulator(s) ── */}
        {countryRegs.length > 0 && (
          <>
            <h2 style={h2}>Official sources for {name}</h2>
            <ul style={{ margin: 0, paddingLeft: 20, fontSize: 14, lineHeight: 2 }}>
              {countryRegs.map((r) => (
                <li key={r.id}>
                  <Link href={`/regulator/${regulatorSlug(r)}`} style={{ color: "var(--teal, #0fa676)", textDecoration: "none", fontWeight: 500 }}>
                    {r.name} ({r.abbreviation})
                  </Link>
                  {" — "}
                  <a href={r.source_url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--app-text-3)" }}>
                    official register
                  </a>
                  {r.last_scraped_at ? (
                    <span style={{ color: "var(--app-text-3)" }}> · last checked {fmtDate(r.last_scraped_at)}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </>
        )}

        {/* ── FAQs ── */}
        <h2 style={h2}>Frequently asked questions</h2>
        {faqs.map((f) => (
          <details key={f.question} style={{ borderTop: "1px solid var(--app-border)", padding: "12px 0" }}>
            <summary style={{ fontSize: 15, fontWeight: 600, cursor: "pointer" }}>{f.question}</summary>
            <p style={{ fontSize: 14, color: "var(--app-text-2)", lineHeight: 1.7, margin: "8px 0 0" }}>{f.answer}</p>
          </details>
        ))}

        {/* ── CTA ── */}
        <div style={{ marginTop: 48, padding: "24px 28px", background: "var(--app-bg-2, #fafbfc)", border: "1px solid var(--app-border)", borderRadius: 14, textAlign: "center" }}>
          <h2 style={{ fontSize: 20, fontWeight: 600, margin: "0 0 6px" }}>
            Track {name} shortages that matter to you
          </h2>
          <p style={{ fontSize: 14, color: "var(--app-text-2)", margin: "0 0 16px" }}>
            Watchlists, email alerts, alternatives and cross-country comparison — free for individual pharmacists and clinicians.
          </p>
          <Link href="/signup" style={{ display: "inline-block", background: "var(--teal, #0fa676)", color: "#fff", padding: "10px 22px", borderRadius: 8, fontSize: 14, fontWeight: 600, textDecoration: "none" }}>
            Create a free account
          </Link>
        </div>

        <p style={{ marginTop: 32, fontSize: 12, color: "var(--app-text-4, #98a2b3)", lineHeight: 1.7 }}>
          Data is aggregated from official sources and provided for information only. Mederti is not
          affiliated with or endorsed by any regulator. Verify with {countryRegs[0]?.abbreviation ?? "the national regulator"} before clinical or procurement decisions.
        </p>
      </main>

      <MinimalFooter />
    </div>
  );
}
