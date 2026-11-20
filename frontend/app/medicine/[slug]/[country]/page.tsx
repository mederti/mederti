import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import AppShell from "@/app/components/v1/AppShell";
import MedicineChatPanel from "../MedicineChatPanel";
import { jsonLdSafe, drugJsonLd, breadcrumbJsonLd, canonicalUrl, siteUrl } from "@/lib/seo";
import {
  drugBySlug,
  eventsForDrug,
  eventsForDrugInCountry,
  isIndexableCountryView,
  trackedCountries,
  fmtDate,
  reasonLabel,
  STATUS_DEFINITIONS,
  type PseoEventDetail,
} from "@/lib/pseo";
import { formOf, productOf, FORM_LABELS } from "@/lib/event-product";
import { extractEventBrand } from "@/lib/event-brand";
import { countryCodeFromSlug, countryName, countrySlug } from "@/lib/geo/country-names";
import { cleanBrandNames } from "@/lib/brand";

// Public, country-specific medicine page: /medicine/[slug]/[country]
// (e.g. /medicine/amoxicillin/australia). Answers "is X short in <country>?"
// with the individual regulator notices behind the answer — product, form,
// dates, source link. Every sentence is built from stored records; nothing
// is inferred. Server-rendered + ISR; robots/sitemap gate in lib/pseo.ts
// (isIndexableCountryView ↔ openCountryMedicinePairs).
export const revalidate = 3600;

const OPEN = new Set(["active", "anticipated"]);

interface NoticeRow {
  id: string;
  status: string;
  product: string | null;
  form: string;
  start: string | null;
  startIsAnticipated: boolean;
  estResolution: string | null;
  /** Open notice whose regulator-estimated resolution date is already past. */
  estLapsed: boolean;
  ended: string | null;
  verified: string | null;
  reason: string | null;
  regulator: string;
  url: string | null;
}

function toRow(e: PseoEventDetail): NoticeRow {
  // Product label: the regulator's own brand/product string when it publishes
  // one; otherwise the notice is ingredient-level and is labelled as such.
  const brand = extractEventBrand(e.data_source_id, e.raw_data).brand_name;
  const product = productOf(e.raw_data) ?? brand;
  const startIsAnticipated = !e.start_date && Boolean(e.anticipated_start_date);
  return {
    id: e.id,
    status: e.status,
    product,
    form: FORM_LABELS[formOf(e.raw_data)],
    start: e.start_date ?? e.anticipated_start_date,
    startIsAnticipated,
    estResolution: e.estimated_resolution_date,
    estLapsed: OPEN.has(e.status) && isPast(e.estimated_resolution_date),
    ended: e.end_date,
    verified: e.last_verified_at,
    reason: e.reason_category && e.reason_category !== "unknown" ? reasonLabel(e.reason_category) : null,
    regulator: e.data_sources?.abbreviation || e.data_sources?.name || "Regulator",
    url: e.source_url ?? e.data_sources?.source_url ?? null,
  };
}

// Evaluated at ISR regeneration (hourly), outside render for purity.
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
function isPast(iso: string | null | undefined): boolean {
  return Boolean(iso && iso.slice(0, 10) < todayIso());
}
function isStaleSource(iso: string | null | undefined): boolean {
  return Boolean(iso && Date.now() - new Date(iso).getTime() > 30 * 86400000);
}

const td = { padding: "10px 12px", fontSize: 14, borderTop: "1px solid var(--app-border)", verticalAlign: "top" as const } as const;
const th = { padding: "10px 12px", fontSize: 12, textTransform: "uppercase" as const, letterSpacing: "0.05em", color: "var(--app-text-3)", textAlign: "left" as const };
const statusColor = (s: string) => (s === "active" ? "#b42318" : s === "anticipated" ? "#b54708" : "var(--app-text-2)");

function NoticeTable({ list, history }: { list: NoticeRow[]; history?: boolean }) {
  return (
    <div style={{ overflowX: "auto", border: "1px solid var(--app-border)", borderRadius: 12 }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={th}>Product</th>
            <th style={th}>Form</th>
            <th style={th}>Status</th>
            <th style={th}>{history ? "Began" : "Start"}</th>
            <th style={th}>{history ? "Resolved" : "Est. resolution"}</th>
            <th style={th}>Source</th>
          </tr>
        </thead>
        <tbody>
          {list.map((r) => (
            <tr key={r.id}>
              <td style={td}>
                {r.product ?? <span style={{ color: "var(--app-text-3)" }}>Ingredient-level notice (product not specified)</span>}
                {r.reason ? <div style={{ fontSize: 12, color: "var(--app-text-3)", marginTop: 2 }}>Cause: {r.reason}</div> : null}
              </td>
              <td style={td}>{r.form}</td>
              <td style={{ ...td, color: statusColor(r.status), fontWeight: 600, whiteSpace: "nowrap" }}>{STATUS_LABEL[r.status] ?? r.status}</td>
              <td style={{ ...td, whiteSpace: "nowrap" }}>
                {fmtDate(r.start)}
                {r.startIsAnticipated ? <span style={{ color: "var(--app-text-3)" }}> (expected)</span> : null}
              </td>
              <td style={{ ...td, whiteSpace: "nowrap" }}>
                {history ? fmtDate(r.ended) : r.estResolution ? fmtDate(r.estResolution) : "Not stated"}
                {!history && r.estLapsed ? (
                  <div style={{ fontSize: 12, color: "#b54708", marginTop: 2, whiteSpace: "normal" }}>Date passed; still listed</div>
                ) : null}
              </td>
              <td style={td}>
                {r.url ? (
                  <a href={r.url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--app-text-2)" }}>
                    {r.regulator} notice ↗
                  </a>
                ) : r.regulator}
                {r.verified ? <div style={{ fontSize: 12, color: "var(--app-text-3)", marginTop: 2 }}>Verified {fmtDate(r.verified)}</div> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const STATUS_LABEL: Record<string, string> = {
  active: "Active shortage",
  anticipated: "Anticipated",
  resolved: "Resolved",
};

function listJoin(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

interface Loaded {
  drug: NonNullable<Awaited<ReturnType<typeof drugBySlug>>>;
  code: string;
  name: string;
  events: PseoEventDetail[];
  open: PseoEventDetail[];
}

async function load(slug: string, country: string): Promise<Loaded | null> {
  const code = countryCodeFromSlug(country);
  if (!code) return null;
  const drug = await drugBySlug(slug);
  if (!drug) return null;
  const events = await eventsForDrugInCountry(drug.id, code);
  return {
    drug,
    code,
    name: countryName(code),
    events,
    open: events.filter((e) => OPEN.has(e.status)),
  };
}

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string; country: string }> },
): Promise<Metadata> {
  const { slug, country } = await params;
  const d = await load(slug, country);
  if (!d) return { title: "Page not found — Mederti", robots: { index: false } };

  const { drug, name, events, open } = d;
  const active = open.filter((e) => e.status === "active").length;
  const anticipated = open.length - active;
  const path = `/medicine/${slug}/${country}`;

  const title = `${drug.generic_name} Shortage in ${name} | Current Status — Mederti`;
  const regs = Array.from(
    new Set(events.map((e) => e.data_sources?.abbreviation || e.data_sources?.name).filter(Boolean)),
  ) as string[];
  const description =
    open.length > 0
      ? `${drug.generic_name} in ${name}: ${active} active${anticipated ? ` and ${anticipated} anticipated` : ""} shortage notice${
          open.length === 1 ? "" : "s"
        }${regs.length ? ` from ${regs.slice(0, 2).join(", ")}` : ""}. Affected products and formulations, start and expected resolution dates, with links to the official notices.`
      : events.length > 0
        ? `No active ${drug.generic_name} shortage notice in ${name} is linked to this record. Past notices${
            regs.length ? ` from ${regs.slice(0, 2).join(", ")}` : ""
          } with dates and official sources.`
        : `${drug.generic_name} shortage status in ${name}, from official regulator data aggregated by Mederti.`;

  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      title,
      description,
      url: canonicalUrl(path),
      type: "website",
      images: [{ url: `${siteUrl()}/api/og/drug/${drug.id}`, width: 1200, height: 630 }],
    },
    robots: isIndexableCountryView(drug, events.length, open.length)
      ? { index: true, follow: true, googleBot: { "max-snippet": -1, "max-image-preview": "large" } }
      : { index: false, follow: true },
  };
}

export default async function MedicineCountryPage(
  { params }: { params: Promise<{ slug: string; country: string }> },
) {
  const { slug, country } = await params;
  const d = await load(slug, country);
  if (!d) notFound();
  const { drug, code, name, events, open } = d;

  const [allEvents, tracked] = await Promise.all([eventsForDrug(drug.id), trackedCountries()]);

  const rows = events.map(toRow);
  const openRows = rows.filter((r) => OPEN.has(r.status));
  const resolvedRows = rows.filter((r) => r.status === "resolved");
  const activeCount = open.filter((e) => e.status === "active").length;
  const anticipatedCount = open.length - activeCount;

  const regulators = Array.from(new Set(rows.map((r) => r.regulator)));
  const trackedHere = tracked?.[code] ?? null;
  const countryRegulators =
    regulators.length > 0
      ? regulators
      : (trackedHere?.sources ?? []).map((s) => s.abbreviation || s.name);
  const lastVerified = events
    .map((e) => e.last_verified_at)
    .filter((v): v is string => Boolean(v))
    .sort()
    .pop();
  const products = new Set(openRows.map((r) => r.product).filter(Boolean));
  const earliestStart = openRows.map((r) => r.start).filter((v): v is string => Boolean(v)).sort()[0];
  const estResolutions = openRows
    .filter((r) => !r.estLapsed)
    .map((r) => r.estResolution)
    .filter((v): v is string => Boolean(v))
    .sort();
  const lapsedCount = openRows.filter((r) => r.estLapsed).length;
  const sourceStale = isStaleSource(lastVerified ?? trackedHere?.latestVerified);
  const lastResolved = resolvedRows.map((r) => r.ended).filter((v): v is string => Boolean(v)).sort().pop();

  // ── Deterministic summary (no model in the loop) ──
  let summary: string;
  if (open.length > 0) {
    summary =
      `${drug.generic_name} has ${activeCount} active shortage notice${activeCount === 1 ? "" : "s"} in ${name}` +
      (anticipatedCount > 0 ? ` and ${anticipatedCount} anticipated` : "") +
      (products.size > 0
        ? `, covering ${products.size} listed product${products.size === 1 ? "" : "s"} or presentation${products.size === 1 ? "" : "s"}`
        : "") +
      `. ` +
      (estResolutions.length > 0
        ? estResolutions[0] === estResolutions[estResolutions.length - 1]
          ? `The regulator-estimated resolution date still ahead is ${fmtDate(estResolutions[0])}. `
          : `Regulator-estimated resolution dates still ahead range from ${fmtDate(estResolutions[0])} to ${fmtDate(estResolutions[estResolutions.length - 1])}. `
        : lapsedCount > 0
          ? ``
          : `The regulator has not published an expected resolution date. `) +
      (lapsedCount > 0
        ? `${lapsedCount} notice${lapsedCount === 1 ? "" : "s"} remain${lapsedCount === 1 ? "s" : ""} listed although the estimated resolution date has passed. `
        : "") +
      `Information last verified by Mederti on ${fmtDate(lastVerified)}, based on records published by ${listJoin(regulators)}.`;
  } else if (events.length > 0) {
    summary =
      `No active shortage notice for ${drug.generic_name} in ${name} is linked to this medicine record. ` +
      `${resolvedRows.length} earlier notice${resolvedRows.length === 1 ? " has" : "s have"} been resolved` +
      (lastResolved ? `, most recently on ${fmtDate(lastResolved)}` : "") +
      `, based on records published by ${listJoin(regulators)}. A resolved notice does not confirm stock at any pharmacy or wholesaler, and notices filed under a salt or local-language name may be held separately — see the ${name} register.`;
  } else if (trackedHere) {
    summary =
      `No shortage notice for ${drug.generic_name} in ${name} is linked to this medicine record. Mederti receives shortage data for ${name} from ${listJoin(
        countryRegulators,
      )}, but notices filed under a salt or local-language name may be held separately — see the ${name} register. This is not confirmation of supply.`;
  } else {
    summary = `Data unavailable: Mederti has no shortage data source for ${name}, so the status of ${drug.generic_name} there is unknown.`;
  }

  // Other markets with open notices for this medicine — internal links.
  const otherOpen = Array.from(
    allEvents
      .filter((e) => OPEN.has(e.status) && e.country_code && e.country_code.toUpperCase() !== code)
      .reduce((m, e) => m.set(e.country_code!.toUpperCase(), (m.get(e.country_code!.toUpperCase()) ?? 0) + 1), new Map<string, number>()),
  ).sort((a, b) => b[1] - a[1]);

  const path = `/medicine/${slug}/${country}`;
  const brandNames = cleanBrandNames(drug.brand_names, drug.generic_name);
  const sourceUrls = Array.from(new Set(rows.map((r) => r.url).filter((u): u is string => Boolean(u))));
  const jsonLd = drugJsonLd(
    { ...drug, brand_names: brandNames },
    [],
    open.length > 0 ? 1 : 0,
    path,
    {
      name: `${drug.generic_name} shortage in ${name}`,
      description: summary,
      dateModified: lastVerified ?? null,
      isBasedOn: sourceUrls,
    },
  );
  const crumbs = breadcrumbJsonLd([
    { name: "Home", path: "/" },
    { name: "Medicines", path: "/medicine" },
    { name: drug.generic_name, path: `/medicine/${slug}` },
    { name: name, path },
  ]);

  const h2 = { fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em", margin: "40px 0 12px" } as const;

  const grounding = [
    `Medicine: ${drug.generic_name}. Country: ${name} (${code}). Summary: ${summary}`,
    `Counts are shortage NOTICES — regulators list each strength/pack separately. Never present a prediction as fact; for "when will it be back" answer only from the estimated resolution dates below and say when none is stated.`,
    `NOTICES (status | product | form | start | est. resolution | ended | regulator | source):`,
    ...rows.slice(0, 60).map(
      (r) =>
        `- ${r.status} | ${r.product ?? "ingredient-level"} | ${r.form} | ${r.start ?? "unknown"}${r.startIsAnticipated ? " (anticipated)" : ""} | ${r.estResolution ?? "not stated"} | ${r.ended ?? "-"} | ${r.regulator}${r.url ? ` <${r.url}>` : ""}`,
    ),
    `OTHER COUNTRIES WITH OPEN NOTICES: ${otherOpen.map(([c, n]) => `${countryName(c)} (${n})`).join(", ") || "none on record"}`,
  ].join("\n");

  return (
    <AppShell
      className="medicine-landing"
      chatScope="panel"
      chatPanel={
        <MedicineChatPanel drugId={drug.id} name={drug.generic_name} slug={slug} basePath={path} bodyText={grounding} />
      }
    >
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdSafe(jsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdSafe(crumbs) }} />

      <article style={{ maxWidth: 820, color: "var(--app-text)" }}>
        <nav aria-label="Breadcrumb" style={{ fontSize: 13, color: "var(--app-text-3)", marginBottom: 16 }}>
          <Link href="/" style={{ color: "inherit" }}>Home</Link>
          {" / "}
          <Link href="/medicine" style={{ color: "inherit" }}>Medicines</Link>
          {" / "}
          <Link href={`/medicine/${slug}`} style={{ color: "inherit" }}>{drug.generic_name}</Link>
          {" / "}
          <span>{name}</span>
        </nav>

        <h1 style={{ fontSize: 34, fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1.15, margin: "0 0 14px" }}>
          {drug.generic_name} shortage in {name}
        </h1>

        <section aria-labelledby="summary-h" style={{ padding: "18px 20px", background: "var(--app-bg-2, #fafbfc)", border: "1px solid var(--app-border)", borderRadius: 12 }}>
          <h2 id="summary-h" style={{ fontSize: 13, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--app-text-3)", margin: "0 0 8px" }}>
            Current shortage summary
          </h2>
          <p style={{ fontSize: 15, lineHeight: 1.7, margin: 0 }}>{summary}</p>
          {sourceStale && (
            <p style={{ fontSize: 13, lineHeight: 1.6, margin: "10px 0 0", color: "#b54708" }}>
              Mederti has not been able to re-check {countryRegulators.join(", ") || "this source"} since{" "}
              {fmtDate(lastVerified ?? trackedHere?.latestVerified)}. The regulator&apos;s current list may differ. Check the
              official notice before relying on this status.
            </p>
          )}
          <dl style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "12px 24px", margin: "16px 0 0" }}>
            {[
              ["Status", open.length > 0 ? (activeCount > 0 ? "Active shortage" : "Anticipated shortage") : events.length > 0 ? "No active notice (resolved history)" : trackedHere ? "No shortage notice on record" : "Data unavailable"],
              ["Jurisdiction", `${name} (${code})`],
              ["Regulator", countryRegulators.length ? countryRegulators.join(", ") : "None tracked"],
              ...(earliestStart ? [["Earliest open notice", fmtDate(earliestStart)]] : []),
              ["Last verified", lastVerified ? fmtDate(lastVerified) : trackedHere?.latestVerified ? `${fmtDate(trackedHere.latestVerified)} (source)` : "—"],
            ].map(([k, v]) => (
              <div key={k}>
                <dt style={{ fontSize: 12, color: "var(--app-text-3)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{k}</dt>
                <dd style={{ margin: "2px 0 0", fontSize: 14, fontWeight: 500 }}>{v}</dd>
              </div>
            ))}
          </dl>
        </section>

        {openRows.length > 0 && (
          <>
            <h2 style={h2}>Affected products and formulations in {name}</h2>
            <p style={{ fontSize: 13, color: "var(--app-text-3)", margin: "0 0 12px" }}>
              One row per regulator notice. Regulators list each strength or pack separately; where a regulator reports at ingredient level only, no product is shown.
            </p>
            <NoticeTable list={openRows} />
          </>
        )}

        {resolvedRows.length > 0 && (
          <>
            <h2 style={h2}>Shortage history in {name}</h2>
            <NoticeTable list={resolvedRows.slice(0, 25)} history />
            {resolvedRows.length > 25 && (
              <p style={{ fontSize: 13, color: "var(--app-text-3)" }}>Showing the 25 most recent of {resolvedRows.length} resolved notices.</p>
            )}
          </>
        )}

        <h2 style={h2}>{drug.generic_name} in other countries</h2>
        {otherOpen.length > 0 ? (
          <p style={{ fontSize: 14, lineHeight: 2, margin: 0 }}>
            Open shortage notices are also on record in{" "}
            {otherOpen.slice(0, 20).map(([c, n], i) => (
              <span key={c}>
                {i > 0 && ", "}
                <Link href={`/medicine/${slug}/${countrySlug(c)}`} style={{ color: "var(--teal, #127A63)", textDecoration: "none", fontWeight: 500 }}>
                  {countryName(c)}
                </Link>{" "}
                <span style={{ color: "var(--app-text-3)" }}>({n})</span>
              </span>
            ))}
            .
          </p>
        ) : (
          <p style={{ fontSize: 14, color: "var(--app-text-2)", margin: 0 }}>No other country has an open notice for {drug.generic_name} on record.</p>
        )}
        <p style={{ fontSize: 14, margin: "10px 0 0" }}>
          <Link href={`/medicine/${slug}`} style={{ color: "var(--teal, #127A63)", fontWeight: 500 }}>Global {drug.generic_name} shortage status →</Link>
          {" · "}
          <Link href={`/country/${countrySlug(code)}/medicine-shortages`} style={{ color: "var(--teal, #127A63)", fontWeight: 500 }}>All medicine shortages in {name} →</Link>
        </p>

        <h2 style={h2}>What the statuses mean</h2>
        <dl style={{ margin: 0, fontSize: 14, lineHeight: 1.7 }}>
          {STATUS_DEFINITIONS.map((s) => (
            <div key={s.term} style={{ marginBottom: 8 }}>
              <dt style={{ fontWeight: 600, display: "inline" }}>{s.term}: </dt>
              <dd style={{ display: "inline", margin: 0, color: "var(--app-text-2)" }}>{s.definition}</dd>
            </div>
          ))}
        </dl>

        <div style={{ marginTop: 40, padding: "24px 28px", background: "var(--app-bg-2, #fafbfc)", border: "1px solid var(--app-border)", borderRadius: 14, textAlign: "center" }}>
          <h2 style={{ fontSize: 20, fontWeight: 600, margin: "0 0 6px" }}>
            Get alerted when {drug.generic_name} status changes in {name}
          </h2>
          <p style={{ fontSize: 14, color: "var(--app-text-2)", margin: "0 0 16px" }}>
            Free for individual pharmacists and clinicians: watchlists, email alerts and product-level detail.
          </p>
          <Link
            href={`/signup?next=${encodeURIComponent(`/drugs/${drug.id}`)}`}
            style={{ display: "inline-block", background: "var(--navy, #090E2C)", color: "#fff", padding: "10px 22px", borderRadius: 8, fontSize: 14, fontWeight: 600, textDecoration: "none" }}
          >
            Create a free account
          </Link>
        </div>

        <p style={{ marginTop: 32, fontSize: 12, color: "var(--app-text-4, #98a2b3)", lineHeight: 1.7 }}>
          Mederti is an independent information service that aggregates notices published by national medicines
          regulators. It is not a regulator and is not affiliated with or endorsed by {countryRegulators.length ? listJoin(countryRegulators) : "any regulator"}.
          A regulator&apos;s shortage status does not confirm or rule out commercial stock at any pharmacy or wholesaler.
          This page is not clinical advice; check the official notice and consult a pharmacist or prescriber before changing treatment.
        </p>
      </article>
    </AppShell>
  );
}
