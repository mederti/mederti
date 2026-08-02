import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import SiteNav from "@/app/components/landing-nav";
import MinimalFooter from "@/app/components/minimal-footer";
import {
  jsonLdSafe,
  drugJsonLd,
  breadcrumbJsonLd,
  faqJsonLd,
  canonicalUrl,
  siteUrl,
} from "@/lib/seo";
import {
  drugBySlug,
  eventsForDrug,
  alternativesForDrug,
  relatedDrugs,
  buildDrugFaqs,
  isIndexableDrug,
  slugify,
  fmtDate,
  reasonLabel,
  type PseoShortageEvent,
} from "@/lib/pseo";
import { countryName, countrySlug } from "@/lib/geo/country-names";
import { cleanBrandNames } from "@/lib/brand";

// Public programmatic SEO page: /medicine/[slug] (e.g. /medicine/amoxicillin).
// Server-rendered, ISR-cached, direct-to-Supabase. The gated product page
// (/drugs/[uuid]) remains the logged-in experience; this page answers the
// "is X in shortage?" query for crawlers, AI engines and anonymous visitors,
// and funnels to signup for alerts/detail.
export const revalidate = 3600;

const SEV_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

interface CountryRollup {
  code: string;
  name: string;
  count: number;
  worstSeverity: string | null;
  since: string | null;
  estResolution: string | null;
  sources: Array<{ abbr: string; url: string | null }>;
}

function rollupByCountry(active: PseoShortageEvent[]): CountryRollup[] {
  const map = new Map<string, CountryRollup>();
  for (const e of active) {
    const code = (e.country_code ?? e.country ?? "??").toUpperCase();
    let row = map.get(code);
    if (!row) {
      row = {
        code,
        name: countryName(code),
        count: 0,
        worstSeverity: null,
        since: null,
        estResolution: null,
        sources: [],
      };
      map.set(code, row);
    }
    row.count += 1;
    if (
      e.severity &&
      (row.worstSeverity === null ||
        (SEV_ORDER[e.severity] ?? 9) < (SEV_ORDER[row.worstSeverity] ?? 9))
    ) {
      row.worstSeverity = e.severity;
    }
    if (e.start_date && (!row.since || e.start_date < row.since)) row.since = e.start_date;
    if (
      e.estimated_resolution_date &&
      (!row.estResolution || e.estimated_resolution_date > row.estResolution)
    ) {
      row.estResolution = e.estimated_resolution_date;
    }
    const abbr = e.data_sources?.abbreviation || e.data_sources?.name;
    if (abbr && !row.sources.some((s) => s.abbr === abbr)) {
      row.sources.push({ abbr, url: e.source_url ?? e.data_sources?.source_url ?? null });
    }
  }
  return Array.from(map.values()).sort(
    (a, b) =>
      (SEV_ORDER[a.worstSeverity ?? ""] ?? 9) - (SEV_ORDER[b.worstSeverity ?? ""] ?? 9) ||
      b.count - a.count,
  );
}

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> },
): Promise<Metadata> {
  const { slug } = await params;
  const drug = await drugBySlug(slug);
  if (!drug) return { title: "Medicine not found — Mederti", robots: { index: false } };

  const events = await eventsForDrug(drug.id);
  const active = events.filter((e) => e.status === "active");
  const countries = Array.from(
    new Set(active.map((e) => countryName(e.country_code ?? e.country))),
  );

  const title =
    active.length > 0
      ? `${drug.generic_name} shortage — live status in ${countries.length} ${
          countries.length === 1 ? "country" : "countries"
        } | Mederti`
      : `Is ${drug.generic_name} in shortage? Live global supply status | Mederti`;

  const description =
    active.length > 0
      ? `${drug.generic_name} has ${active.length} active shortage notice${
          active.length === 1 ? "" : "s"
        } (${countries.slice(0, 4).join(", ")}${countries.length > 4 ? " and more" : ""}). Causes, regulator sources, history and alternatives — updated daily from official sources.`
      : `${drug.generic_name}: no active shortage currently reported by the 40+ national medicines regulators Mederti tracks. Check live status, shortage history and alternatives.`;

  return {
    title,
    description,
    alternates: { canonical: `/medicine/${slug}` },
    openGraph: {
      title,
      description,
      url: canonicalUrl(`/medicine/${slug}`),
      type: "website",
      images: [{ url: `${siteUrl()}/api/og/drug/${drug.id}`, width: 1200, height: 630 }],
    },
    // Same gate as the sitemap (isIndexableDrug): only entity-strong drugs
    // with real shortage history enter the index; the rest stay reachable
    // and followable without flooding Google with thin pages.
    robots: isIndexableDrug(drug, events.length)
      ? { index: true, follow: true, googleBot: { "max-snippet": -1, "max-image-preview": "large" } }
      : { index: false, follow: true },
  };
}

const sevColor: Record<string, string> = {
  critical: "#b42318",
  high: "#b54708",
  medium: "#b58a00",
  low: "#0fa676",
};

export default async function MedicinePage(
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const drug = await drugBySlug(slug);
  if (!drug) notFound();

  const [events, alternatives, related] = await Promise.all([
    eventsForDrug(drug.id),
    alternativesForDrug(drug.id),
    relatedDrugs(drug),
  ]);

  const active = events.filter((e) => e.status === "active");
  const anticipated = events.filter((e) => e.status === "anticipated");
  const resolved = events.filter((e) => e.status === "resolved").slice(0, 8);
  const brandNames = cleanBrandNames(drug.brand_names, drug.generic_name);
  const rollup = rollupByCountry(active);
  const countryNames = rollup.map((r) => r.name);
  const faqs = buildDrugFaqs(drug.generic_name, active, countryNames, alternatives.length);
  const lastUpdated = events
    .map((e) => e.updated_at ?? e.last_verified_at)
    .filter(Boolean)
    .sort()
    .pop();

  const jsonLd = drugJsonLd(
    { ...drug, brand_names: brandNames },
    active.map((e) => ({
      country: e.country_code ?? e.country,
      severity: e.severity ?? "unknown",
      status: e.status,
      start_date: e.start_date,
    })),
    rollup.length,
    `/medicine/${slug}`,
  );
  const crumbs = breadcrumbJsonLd([
    { name: "Home", path: "/" },
    { name: "Medicines", path: "/medicine" },
    { name: drug.generic_name, path: `/medicine/${slug}` },
  ]);

  const h2 = { fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em", margin: "40px 0 12px" } as const;
  const td = { padding: "10px 12px", fontSize: 14, borderTop: "1px solid var(--app-border)" } as const;
  const th = { padding: "10px 12px", fontSize: 12, textTransform: "uppercase" as const, letterSpacing: "0.05em", color: "var(--app-text-3)", textAlign: "left" as const };

  return (
    <div style={{ background: "#fff", minHeight: "100vh", color: "var(--app-text)", fontFamily: "var(--font-geist-sans), sans-serif" }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdSafe(jsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdSafe(crumbs) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdSafe(faqJsonLd(faqs)) }} />
      <SiteNav />

      <main style={{ maxWidth: 760, margin: "0 auto", padding: "48px 24px 80px" }}>
        <nav aria-label="Breadcrumb" style={{ fontSize: 13, color: "var(--app-text-3)", marginBottom: 16 }}>
          <Link href="/" style={{ color: "inherit" }}>Home</Link>
          {" / "}
          <Link href="/medicine" style={{ color: "inherit" }}>Medicines</Link>
          {" / "}
          <span>{drug.generic_name}</span>
        </nav>

        <h1 style={{ fontSize: 34, fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1.15, margin: "0 0 10px" }}>
          {drug.generic_name} shortage status
        </h1>
        <p style={{ fontSize: 15, color: "var(--app-text-2)", lineHeight: 1.7, margin: "0 0 6px" }}>
          {active.length > 0 ? (
            <>
              <strong style={{ color: "#b42318" }}>
                {active.length} active shortage notice{active.length === 1 ? "" : "s"}
              </strong>{" "}
              across {rollup.length} {rollup.length === 1 ? "country" : "countries"}
              {anticipated.length > 0 ? <> · {anticipated.length} anticipated</> : null}.
            </>
          ) : (
            <>
              <strong style={{ color: "var(--teal, #0fa676)" }}>No active shortage</strong> currently
              reported by the regulators Mederti tracks
              {anticipated.length > 0 ? <> — {anticipated.length} anticipated notice{anticipated.length === 1 ? "" : "s"} on file</> : null}.
            </>
          )}
        </p>
        {lastUpdated && (
          <p style={{ fontSize: 13, color: "var(--app-text-3)", margin: 0 }}>
            Last updated {fmtDate(lastUpdated)} · sourced from official medicines regulators
          </p>
        )}

        {/* ── Drug facts ── */}
        <section aria-label="Medicine facts" style={{ marginTop: 28, padding: "18px 20px", background: "var(--app-bg-2, #fafbfc)", border: "1px solid var(--app-border)", borderRadius: 12 }}>
          <dl style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "12px 24px", margin: 0 }}>
            <div>
              <dt style={{ fontSize: 12, color: "var(--app-text-3)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Generic name (INN)</dt>
              <dd style={{ margin: "2px 0 0", fontSize: 14, fontWeight: 500 }}>{drug.generic_name}</dd>
            </div>
            {brandNames.length > 0 && (
              <div>
                <dt style={{ fontSize: 12, color: "var(--app-text-3)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Brand names</dt>
                <dd style={{ margin: "2px 0 0", fontSize: 14 }}>{brandNames.slice(0, 6).join(", ")}{brandNames.length > 6 ? "…" : ""}</dd>
              </div>
            )}
            {drug.atc_code && (
              <div>
                <dt style={{ fontSize: 12, color: "var(--app-text-3)", textTransform: "uppercase", letterSpacing: "0.05em" }}>ATC code</dt>
                <dd style={{ margin: "2px 0 0", fontSize: 14 }}>{drug.atc_code}{drug.atc_description ? ` — ${drug.atc_description}` : ""}</dd>
              </div>
            )}
            {(drug.drug_class || drug.therapeutic_category) && (
              <div>
                <dt style={{ fontSize: 12, color: "var(--app-text-3)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Class</dt>
                <dd style={{ margin: "2px 0 0", fontSize: 14 }}>{drug.drug_class ?? drug.therapeutic_category}</dd>
              </div>
            )}
            {drug.dosage_forms && drug.dosage_forms.length > 0 && (
              <div>
                <dt style={{ fontSize: 12, color: "var(--app-text-3)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Forms</dt>
                <dd style={{ margin: "2px 0 0", fontSize: 14 }}>{drug.dosage_forms.slice(0, 5).join(", ")}</dd>
              </div>
            )}
            {drug.who_essential_medicine && (
              <div>
                <dt style={{ fontSize: 12, color: "var(--app-text-3)", textTransform: "uppercase", letterSpacing: "0.05em" }}>WHO Essential Medicine</dt>
                <dd style={{ margin: "2px 0 0", fontSize: 14 }}>Yes{drug.who_eml_section ? ` — ${drug.who_eml_section}` : ""}</dd>
              </div>
            )}
          </dl>
        </section>

        {/* ── Per-country status ── */}
        {rollup.length > 0 && (
          <>
            <h2 style={h2}>Where {drug.generic_name} is in shortage</h2>
            <div style={{ overflowX: "auto", border: "1px solid var(--app-border)", borderRadius: 12 }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={th}>Country</th>
                    <th style={th}>Severity</th>
                    <th style={th}>Notices</th>
                    <th style={th}>Since</th>
                    <th style={th}>Est. resolution</th>
                    <th style={th}>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {rollup.map((r) => (
                    <tr key={r.code}>
                      <td style={td}>
                        <Link href={`/country/${countrySlug(r.code)}/medicine-shortages`} style={{ color: "var(--teal, #0fa676)", textDecoration: "none", fontWeight: 500 }}>
                          {r.name}
                        </Link>
                      </td>
                      <td style={td}>
                        {r.worstSeverity ? (
                          <span style={{ color: sevColor[r.worstSeverity] ?? "var(--app-text-2)", fontWeight: 600, textTransform: "capitalize" }}>{r.worstSeverity}</span>
                        ) : "—"}
                      </td>
                      <td style={td}>{r.count}</td>
                      <td style={td}>{fmtDate(r.since)}</td>
                      <td style={td}>{fmtDate(r.estResolution)}</td>
                      <td style={td}>
                        {r.sources.slice(0, 2).map((s, i) => (
                          <span key={s.abbr}>
                            {i > 0 && ", "}
                            {s.url ? (
                              <a href={s.url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--app-text-2)" }}>{s.abbr}</a>
                            ) : s.abbr}
                          </span>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* ── Reasons ── */}
        {active.some((e) => e.reason_category || e.reason) && (
          <>
            <h2 style={h2}>Why {drug.generic_name} is in shortage</h2>
            <ul style={{ margin: 0, paddingLeft: 20, fontSize: 14, color: "var(--app-text-2)", lineHeight: 1.8 }}>
              {Array.from(
                new Map(
                  active
                    .filter((e) => e.reason_category)
                    .map((e) => [e.reason_category as string, e]),
                ).values(),
              ).map((e) => (
                <li key={e.id}>
                  <strong style={{ color: "var(--app-text)", textTransform: "capitalize" }}>
                    {reasonLabel(e.reason_category)}
                  </strong>
                  {e.reason ? <> — e.g. “{e.reason.slice(0, 180)}{e.reason.length > 180 ? "…" : ""}” ({countryName(e.country_code ?? e.country)})</> : null}
                </li>
              ))}
            </ul>
          </>
        )}

        {/* ── Alternatives ── */}
        {alternatives.length > 0 && (
          <>
            <h2 style={h2}>Alternatives to {drug.generic_name}</h2>
            <p style={{ fontSize: 13, color: "var(--app-text-3)", margin: "0 0 12px" }}>
              Clinically related options from Mederti&apos;s curated alternatives data. Always confirm suitability with a pharmacist or prescriber before substituting.
            </p>
            <ul style={{ margin: 0, paddingLeft: 20, fontSize: 14, lineHeight: 1.9 }}>
              {alternatives.map((a) => (
                <li key={a.alternative_drug_id}>
                  {a.drugs?.generic_name ? (
                    <Link href={`/medicine/${slugify(a.drugs.generic_name)}`} style={{ color: "var(--teal, #0fa676)", textDecoration: "none", fontWeight: 500 }}>
                      {a.drugs.generic_name}
                    </Link>
                  ) : "Unnamed"}
                  {a.relationship_type ? <span style={{ color: "var(--app-text-3)" }}> — {a.relationship_type.replace(/_/g, " ")}</span> : null}
                </li>
              ))}
            </ul>
          </>
        )}

        {/* ── History ── */}
        {resolved.length > 0 && (
          <>
            <h2 style={h2}>Recent shortage history</h2>
            <ul style={{ margin: 0, paddingLeft: 20, fontSize: 14, color: "var(--app-text-2)", lineHeight: 1.9 }}>
              {resolved.map((e) => (
                <li key={e.id}>
                  {countryName(e.country_code ?? e.country)}: resolved
                  {e.end_date ? ` ${fmtDate(e.end_date)}` : ""}
                  {e.start_date ? ` (began ${fmtDate(e.start_date)})` : ""}
                </li>
              ))}
            </ul>
          </>
        )}

        {/* ── FAQs (rendered verbatim — mirrors the FAQPage JSON-LD) ── */}
        <h2 style={h2}>Frequently asked questions</h2>
        {faqs.map((f) => (
          <details key={f.question} style={{ borderTop: "1px solid var(--app-border)", padding: "12px 0" }}>
            <summary style={{ fontSize: 15, fontWeight: 600, cursor: "pointer" }}>{f.question}</summary>
            <p style={{ fontSize: 14, color: "var(--app-text-2)", lineHeight: 1.7, margin: "8px 0 0" }}>{f.answer}</p>
          </details>
        ))}

        {/* ── Related medicines ── */}
        {related.length > 0 && (
          <>
            <h2 style={h2}>Related medicines</h2>
            <p style={{ fontSize: 14, lineHeight: 2 }}>
              {related.map((r, i) => (
                <span key={r.id}>
                  {i > 0 && " · "}
                  <Link href={`/medicine/${slugify(r.generic_name)}`} style={{ color: "var(--teal, #0fa676)", textDecoration: "none" }}>
                    {r.generic_name}
                  </Link>
                </span>
              ))}
            </p>
          </>
        )}

        {/* ── CTA ── */}
        <div style={{ marginTop: 48, padding: "24px 28px", background: "var(--app-bg-2, #fafbfc)", border: "1px solid var(--app-border)", borderRadius: 14, textAlign: "center" }}>
          <h2 style={{ fontSize: 20, fontWeight: 600, margin: "0 0 6px" }}>
            Get alerted when {drug.generic_name} status changes
          </h2>
          <p style={{ fontSize: 14, color: "var(--app-text-2)", margin: "0 0 16px" }}>
            Free for individual pharmacists and clinicians — watchlists, email alerts, alternatives and country-by-country product detail.
          </p>
          <Link
            href={`/signup?next=${encodeURIComponent(`/drugs/${drug.id}`)}`}
            style={{ display: "inline-block", background: "var(--teal, #0fa676)", color: "#fff", padding: "10px 22px", borderRadius: 8, fontSize: 14, fontWeight: 600, textDecoration: "none" }}
          >
            Create a free account
          </Link>
        </div>

        <p style={{ marginTop: 32, fontSize: 12, color: "var(--app-text-4, #98a2b3)", lineHeight: 1.7 }}>
          Data on this page is aggregated from official national medicines regulators and updated daily.
          It is provided for information only and requires verification before clinical use. Mederti is
          not affiliated with or endorsed by any regulator.
        </p>
      </main>

      <MinimalFooter />
    </div>
  );
}
