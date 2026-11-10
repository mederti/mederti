import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import AppShell from "@/app/components/v1/AppShell";
import CountryChatPanel from "./CountryChatPanel";
import CountryNotices, { type NoticeRow } from "./CountryNotices";
import CountrySwitcher from "./CountrySwitcher";
import {
  jsonLdSafe,
  breadcrumbJsonLd,
  faqJsonLd,
  datasetJsonLd,
  canonicalUrl,
  defaultOgImages,
} from "@/lib/seo";
import {
  countrySummary,
  allRegulators,
  regulatorSlug,
  slugify,
  fmtDate,
  reasonLabel,
  type Faq,
  type PseoShortageEventWithDrug,
} from "@/lib/pseo";
import { countryCodeFromSlug, countryName, countrySlug, COUNTRY_NAMES } from "@/lib/geo/country-names";

// Public programmatic SEO page: /country/[slug]/medicine-shortages
// (e.g. /country/australia/medicine-shortages). The per-country live register,
// refreshed hourly, with Dataset structured data for Google Dataset Search
// and AI retrieval.
export const revalidate = 3600;

function toRow(e: PseoShortageEventWithDrug): NoticeRow {
  const med = e.drugs?.generic_name ?? null;
  return {
    id: e.id,
    medicine: med,
    medicineSlug: med ? slugify(med) : null,
    status: e.status,
    severity: e.severity,
    reason: reasonLabel(e.reason_category),
    startDate: e.start_date,
    resolutionDate: e.estimated_resolution_date,
    sourceUrl: e.source_url,
    sourceLabel: e.data_sources?.abbreviation ?? e.data_sources?.name ?? "Source",
  };
}

// Grounding text for the page's chat: exactly what the page shows, plus how to
// treat forward-looking questions honestly.
function groundingText(
  name: string,
  code: string,
  s: Awaited<ReturnType<typeof countrySummary>>,
  regs: { name: string; abbreviation: string | null }[],
): string {
  const line = (e: PseoShortageEventWithDrug, dateLabel: string, date: string | null) =>
    `- ${e.drugs?.generic_name ?? "Unlinked product"} | ${e.status}${e.severity ? ` | ${e.severity}` : ""}${
      reasonLabel(e.reason_category) ? ` | ${reasonLabel(e.reason_category)}` : ""
    } | ${dateLabel} ${date ?? "unknown"} | ${e.data_sources?.abbreviation ?? e.data_sources?.name ?? "source"}`;
  const parts = [
    `Country: ${name} (${code}). Official sources: ${regs.map((r) => `${r.name}${r.abbreviation ? ` (${r.abbreviation})` : ""}`).join(", ") || "unknown"}.`,
    `Counts (notices, not medicines — regulators list each strength/pack separately): active ${s.active ?? "unknown"}, distinct medicines affected ${s.activeMedicines ?? "unknown"}, anticipated (any start date) ${s.anticipated ?? "unknown"}, announced upcoming (start date still ahead) ${s.upcomingTotal ?? "unknown"}, critical ${s.critical ?? "unknown"}.`,
    `HOW TO ANSWER FORWARD-LOOKING QUESTIONS ("what will be short in 6 months", "what should I buy now"): Mederti has no validated shortage forecast — its backtests did not hold up — so never present a prediction or risk score as fact. Answer from regulator facts: (1) the announced-upcoming notices below (anticipated or future start date), (2) active notices with estimated resolution dates, (3) critical active notices, and you may use tools to check whether the same medicines are short in other markets, labelled as context not prediction. For purchasing questions, frame as "what the published notices suggest preparing for", cite the notices and dates, and say it is not procurement advice. If the lists are empty, say so plainly.`,
    `ANNOUNCED UPCOMING (soonest ${s.upcoming.length} of ${s.upcomingTotal ?? "unknown"}):`,
    ...s.upcoming.map((e) => line(e, "starts", e.start_date)),
    `ACTIVE WITH ESTIMATED RESOLUTION (${s.resolving.length}):`,
    ...s.resolving.map((e) => line(e, "est. resolution", e.estimated_resolution_date)),
    `LATEST ACTIVE NOTICES (${s.recent.length} most recent):`,
    ...s.recent.map((e) => line(e, "since", e.start_date)),
  ];
  return parts.join("\n");
}

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
    openGraph: { title, description, url: canonicalUrl(`/country/${slug}/medicine-shortages`), type: "website", images: defaultOgImages() },
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

  // Countries for the switcher: those with an active regulator source.
  const switchCodes = Array.from(
    new Set(regulators.filter((r) => r.is_active).map((r) => r.country_code)),
  ).filter((c) => COUNTRY_NAMES[c] && c !== "EU");
  if (!switchCodes.includes(code)) switchCodes.push(code);
  const countries = switchCodes
    .map((c) => ({ slug: countrySlug(c), name: countryName(c) }))
    .sort((a, b) => a.name.localeCompare(b.name));

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

  const h2 = { fontSize: 20, fontWeight: 600, letterSpacing: "-0.02em", margin: "40px 0 12px" } as const;

  const stat = (label: string, value: number | null, color?: string, sub?: string) => (
    <div style={{ padding: "14px 18px", border: "1px solid var(--app-border, #e8ecf0)", borderRadius: 12, minWidth: 140, flex: "1 1 140px", background: "#fff" }}>
      <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-0.02em", color: color ?? "var(--app-text, #0c1118)" }}>
        {value === null ? "—" : value.toLocaleString()}
      </div>
      <div style={{ fontSize: 12, color: "var(--app-text-3, #6a7280)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
      {sub ? <div style={{ fontSize: 12, color: "var(--app-text-3, #98a1ac)", marginTop: 2 }}>{sub}</div> : null}
    </div>
  );

  const lastChecked = countryRegs
    .map((r) => r.last_scraped_at)
    .filter((d): d is string => !!d)
    .sort()
    .pop();

  return (
    <AppShell
      className="country-landing"
      chatScope="panel"
      chatPanel={
        <CountryChatPanel
          code={code}
          name={name}
          slug={slug}
          bodyText={groundingText(name, code, summary, countryRegs)}
        />
      }
    >
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdSafe(crumbs) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdSafe(dataset) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdSafe(faqJsonLd(faqs)) }} />

      <div style={{ maxWidth: 960, color: "var(--app-text, #0c1118)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
          <nav aria-label="Breadcrumb" style={{ fontSize: 13, color: "var(--app-text-3, #6a7280)" }}>
            <Link href="/country" style={{ color: "inherit" }}>Countries</Link>
            {" / "}
            <span>{name}</span>
          </nav>
          <CountrySwitcher current={slug} countries={countries} />
        </div>

        <h1 style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1.15, margin: "0 0 8px" }}>
          Medicine shortages in {name}
        </h1>
        <p style={{ fontSize: 15, color: "var(--app-text-2, #3b434e)", lineHeight: 1.65, margin: "0 0 20px", maxWidth: 680 }}>
          Live register of drug shortage notices in {name}, aggregated daily from official
          regulator publications and linked back to every source.
          {lastChecked ? <> Last checked {fmtDate(lastChecked)}.</> : null}
        </p>

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {stat("Active notices", summary.active, "#b42318")}
          {stat("Medicines affected", summary.activeMedicines)}
          {stat("Announced upcoming", summary.upcomingTotal, "#b54708", "start date still ahead")}
          {stat("Critical severity", summary.critical)}
        </div>
        <p style={{ fontSize: 13, color: "var(--app-text-3, #6a7280)", lineHeight: 1.6, margin: "10px 0 0", maxWidth: 680 }}>
          Regulators list each strength and pack separately, so one medicine can carry several
          notices — compare official per-medicine tallies against &ldquo;Medicines affected&rdquo;.{" "}
          <Link href="/methodology" style={{ color: "inherit" }}>How we count</Link>
        </p>

        <CountryNotices
          name={name}
          latest={summary.recent.map(toRow)}
          upcoming={summary.upcoming.map(toRow)}
          upcomingTotal={summary.upcomingTotal}
          resolving={summary.resolving.map(toRow)}
          activeTotal={summary.active}
        />

        {countryRegs.length > 0 && (
          <>
            <h2 style={h2}>Official sources for {name}</h2>
            <ul style={{ margin: 0, paddingLeft: 20, fontSize: 14, lineHeight: 2 }}>
              {countryRegs.map((r) => (
                <li key={r.id}>
                  <Link href={`/regulator/${regulatorSlug(r)}`} style={{ color: "var(--teal, #127A63)", textDecoration: "none", fontWeight: 500 }}>
                    {r.name} ({r.abbreviation})
                  </Link>
                  {" — "}
                  <a href={r.source_url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--app-text-3, #6a7280)" }}>
                    official register
                  </a>
                  {r.last_scraped_at ? (
                    <span style={{ color: "var(--app-text-3, #6a7280)" }}> · last checked {fmtDate(r.last_scraped_at)}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </>
        )}

        <h2 style={h2}>Frequently asked questions</h2>
        {faqs.map((f) => (
          <details key={f.question} style={{ borderTop: "1px solid var(--app-border, #e8ecf0)", padding: "12px 0" }}>
            <summary style={{ fontSize: 15, fontWeight: 600, cursor: "pointer" }}>{f.question}</summary>
            <p style={{ fontSize: 14, color: "var(--app-text-2, #3b434e)", lineHeight: 1.7, margin: "8px 0 0" }}>{f.answer}</p>
          </details>
        ))}

        <p style={{ marginTop: 32, fontSize: 12, color: "var(--app-text-4, #98a2b3)", lineHeight: 1.7 }}>
          Data is aggregated from official sources and provided for information only. Mederti is not
          affiliated with or endorsed by any regulator. Verify with {countryRegs[0]?.abbreviation ?? "the national regulator"} before clinical or procurement decisions.
        </p>
      </div>
    </AppShell>
  );
}
