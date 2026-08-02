import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import SiteNav from "@/app/components/landing-nav";
import MinimalFooter from "@/app/components/minimal-footer";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { jsonLdSafe, breadcrumbJsonLd, canonicalUrl } from "@/lib/seo";
import { regulatorBySlug, slugify, fmtDate } from "@/lib/pseo";
import { countryName, countrySlug } from "@/lib/geo/country-names";

// Public programmatic SEO page: /regulator/[slug] (e.g. /regulator/tga-au).
// Profiles one official source Mederti scrapes: what it publishes, how often
// we check it, and its latest notices — the citation trail behind every
// shortage record on the site.
export const revalidate = 21600;

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> },
): Promise<Metadata> {
  const { slug } = await params;
  const reg = await regulatorBySlug(slug);
  if (!reg) return { title: "Regulator not found — Mederti", robots: { index: false } };
  const cn = countryName(reg.country_code);
  const title = `${reg.abbreviation} medicine shortage reporting — ${cn} | Mederti`;
  const description = `${reg.name} (${reg.abbreviation}) publishes official medicine shortage notices for ${cn}. See what it reports, how often Mederti checks it, and its latest shortage notices.`;
  return {
    title,
    description,
    alternates: { canonical: `/regulator/${slug}` },
    openGraph: { title, description, url: canonicalUrl(`/regulator/${slug}`), type: "website" },
  };
}

export default async function RegulatorPage(
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const reg = await regulatorBySlug(slug);
  if (!reg) notFound();

  const cn = countryName(reg.country_code);

  let eventCount: number | null = null;
  let recent: Array<{
    id: string;
    status: string;
    severity: string | null;
    start_date: string | null;
    source_url: string | null;
    drugs: { generic_name: string } | null;
  }> = [];
  try {
    const admin = getSupabaseAdmin();
    const [countRes, recentRes] = await Promise.all([
      admin
        .from("shortage_events")
        .select("id", { count: "exact", head: true })
        .eq("data_source_id", reg.id),
      admin
        .from("shortage_events")
        .select("id, status, severity, start_date, source_url, drugs(generic_name)")
        .eq("data_source_id", reg.id)
        .not("drug_id", "is", null)
        .in("status", ["active", "anticipated"])
        .order("start_date", { ascending: false, nullsFirst: false })
        .limit(15),
    ]);
    eventCount = countRes.count ?? null;
    recent = (recentRes.data ?? []) as unknown as typeof recent;
  } catch {
    // fail soft — profile still renders
  }

  const orgJsonLd = {
    "@context": "https://schema.org",
    "@type": "GovernmentOrganization",
    "name": reg.name,
    "alternateName": reg.abbreviation,
    "url": reg.source_url,
    "areaServed": { "@type": "Country", "name": cn },
  };
  const crumbs = breadcrumbJsonLd([
    { name: "Home", path: "/" },
    { name: "Regulators", path: "/regulator" },
    { name: reg.abbreviation, path: `/regulator/${slug}` },
  ]);

  const h2 = { fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em", margin: "40px 0 12px" } as const;

  return (
    <div style={{ background: "#fff", minHeight: "100vh", color: "var(--app-text)", fontFamily: "var(--font-geist-sans), sans-serif" }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdSafe(orgJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdSafe(crumbs) }} />
      <SiteNav />

      <main style={{ maxWidth: 760, margin: "0 auto", padding: "48px 24px 80px" }}>
        <nav aria-label="Breadcrumb" style={{ fontSize: 13, color: "var(--app-text-3)", marginBottom: 16 }}>
          <Link href="/" style={{ color: "inherit" }}>Home</Link>
          {" / "}
          <Link href="/regulator" style={{ color: "inherit" }}>Regulators</Link>
          {" / "}
          <span>{reg.abbreviation}</span>
        </nav>

        <h1 style={{ fontSize: 32, fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1.2, margin: "0 0 10px" }}>
          {reg.name} ({reg.abbreviation})
        </h1>
        <p style={{ fontSize: 15, color: "var(--app-text-2)", lineHeight: 1.7, margin: "0 0 24px", maxWidth: 640 }}>
          {reg.name} is the official source of medicine shortage information for{" "}
          <Link href={`/country/${countrySlug(reg.country_code)}/medicine-shortages`} style={{ color: "var(--teal, #0fa676)", textDecoration: "none", fontWeight: 500 }}>
            {cn}
          </Link>
          {reg.region ? ` (${reg.region})` : ""}. Mederti checks its register{" "}
          {reg.scrape_frequency_hours && reg.scrape_frequency_hours <= 24 ? "daily" : "regularly"} and
          links every notice back to the original publication.
        </p>

        <dl style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px 24px", margin: 0, padding: "18px 20px", background: "var(--app-bg-2, #fafbfc)", border: "1px solid var(--app-border)", borderRadius: 12 }}>
          <div>
            <dt style={{ fontSize: 12, color: "var(--app-text-3)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Official register</dt>
            <dd style={{ margin: "2px 0 0", fontSize: 14 }}>
              <a href={reg.source_url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--teal, #0fa676)" }}>
                {new URL(reg.source_url).hostname}
              </a>
            </dd>
          </div>
          <div>
            <dt style={{ fontSize: 12, color: "var(--app-text-3)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Country</dt>
            <dd style={{ margin: "2px 0 0", fontSize: 14 }}>{cn}</dd>
          </div>
          {eventCount !== null && (
            <div>
              <dt style={{ fontSize: 12, color: "var(--app-text-3)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Notices tracked by Mederti</dt>
              <dd style={{ margin: "2px 0 0", fontSize: 14 }}>{eventCount.toLocaleString()}</dd>
            </div>
          )}
          {reg.last_scraped_at && (
            <div>
              <dt style={{ fontSize: 12, color: "var(--app-text-3)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Last checked</dt>
              <dd style={{ margin: "2px 0 0", fontSize: 14 }}>{fmtDate(reg.last_scraped_at)}</dd>
            </div>
          )}
        </dl>

        {recent.length > 0 && (
          <>
            <h2 style={h2}>Latest notices from {reg.abbreviation}</h2>
            <ul style={{ margin: 0, paddingLeft: 20, fontSize: 14, lineHeight: 2 }}>
              {recent.map((e) => (
                <li key={e.id}>
                  {e.drugs?.generic_name ? (
                    <Link href={`/medicine/${slugify(e.drugs.generic_name)}`} style={{ color: "var(--teal, #0fa676)", textDecoration: "none", fontWeight: 500 }}>
                      {e.drugs.generic_name}
                    </Link>
                  ) : (
                    <span style={{ color: "var(--app-text-2)" }}>Unlinked product</span>
                  )}
                  <span style={{ color: "var(--app-text-3)" }}>
                    {" "}— {e.status}
                    {e.severity ? `, ${e.severity}` : ""}
                    {e.start_date ? `, since ${fmtDate(e.start_date)}` : ""}
                  </span>
                  {e.source_url && (
                    <>
                      {" "}
                      <a href={e.source_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: "var(--app-text-3)" }}>
                        (source)
                      </a>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}

        <div style={{ marginTop: 48, padding: "24px 28px", background: "var(--app-bg-2, #fafbfc)", border: "1px solid var(--app-border)", borderRadius: 14, textAlign: "center" }}>
          <h2 style={{ fontSize: 20, fontWeight: 600, margin: "0 0 6px" }}>
            Every {reg.abbreviation} notice, searchable and alertable
          </h2>
          <p style={{ fontSize: 14, color: "var(--app-text-2)", margin: "0 0 16px" }}>
            Search {cn}&apos;s full register alongside 50+ other countries — free for individual pharmacists and clinicians.
          </p>
          <Link href="/signup" style={{ display: "inline-block", background: "var(--teal, #0fa676)", color: "#fff", padding: "10px 22px", borderRadius: 8, fontSize: 14, fontWeight: 600, textDecoration: "none" }}>
            Create a free account
          </Link>
        </div>

        <p style={{ marginTop: 32, fontSize: 12, color: "var(--app-text-4, #98a2b3)", lineHeight: 1.7 }}>
          Mederti is not affiliated with or endorsed by {reg.name}. All notices remain the property of
          their publisher and are linked to the original source.
        </p>
      </main>

      <MinimalFooter />
    </div>
  );
}
