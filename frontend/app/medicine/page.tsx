import type { Metadata } from "next";
import Link from "next/link";
import SiteNav from "@/app/components/landing-nav";
import MinimalFooter from "@/app/components/minimal-footer";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { jsonLdSafe, breadcrumbJsonLd } from "@/lib/seo";
import { slugify } from "@/lib/pseo";

// Hub page linking into the /medicine/[slug] programmatic pages so they are
// reachable by crawl (not just via the sitemap). Refreshed every 6h.
export const revalidate = 21600;

export const metadata: Metadata = {
  title: "Medicine shortages by drug — live global status | Mederti",
  description:
    "Browse live shortage status for the medicines most affected right now, tracked daily from 40+ official regulators across 50+ countries.",
  alternates: { canonical: "/medicine" },
};

interface TopDrug {
  id: string;
  generic_name: string;
  count: number;
}

async function topShortageDrugs(): Promise<TopDrug[]> {
  try {
    const admin = getSupabaseAdmin();

    // Count active notices per drug. PostgREST caps a response at 1000 rows,
    // so page through up to 8k active events; enough to rank the head of the
    // distribution, which is all a hub page needs.
    const counts = new Map<string, number>();
    for (let page = 0; page < 8; page++) {
      const { data, error } = await admin
        .from("shortage_events")
        .select("drug_id")
        .eq("status", "active")
        .not("drug_id", "is", null)
        .or("synthetic.is.null,synthetic.eq.false")
        .range(page * 1000, page * 1000 + 999);
      if (error || !data || data.length === 0) break;
      for (const row of data as Array<{ drug_id: string }>) {
        counts.set(row.drug_id, (counts.get(row.drug_id) ?? 0) + 1);
      }
      if (data.length < 1000) break;
    }

    const top = Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 96);
    if (top.length === 0) return [];

    const { data: drugs } = await admin
      .from("drugs")
      .select("id, generic_name")
      .in("id", top.map(([id]) => id));

    const nameById = new Map((drugs ?? []).map((d) => [d.id, d.generic_name]));
    return top
      .filter(([id]) => nameById.has(id))
      .map(([id, count]) => ({ id, generic_name: nameById.get(id) as string, count }));
  } catch {
    return [];
  }
}

export default async function MedicineHubPage() {
  const top = await topShortageDrugs();
  const crumbs = breadcrumbJsonLd([
    { name: "Home", path: "/" },
    { name: "Medicines", path: "/medicine" },
  ]);

  return (
    <div style={{ background: "#fff", minHeight: "100vh", color: "var(--app-text)", fontFamily: "var(--font-geist-sans), sans-serif" }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdSafe(crumbs) }} />
      <SiteNav />

      <main style={{ maxWidth: 860, margin: "0 auto", padding: "48px 24px 80px" }}>
        <h1 style={{ fontSize: 34, fontWeight: 700, letterSpacing: "-0.03em", margin: "0 0 10px" }}>
          Medicine shortages, by drug
        </h1>
        <p style={{ fontSize: 15, color: "var(--app-text-2)", lineHeight: 1.7, margin: "0 0 8px", maxWidth: 640 }}>
          Live shortage status for every medicine Mederti tracks, aggregated daily from official
          national regulators in 50+ countries. Below are the medicines with the most active
          shortage notices right now — or search the full database with a free account.
        </p>
        <p style={{ fontSize: 13, color: "var(--app-text-3)", margin: "0 0 28px" }}>
          Browse by <Link href="/country" style={{ color: "var(--teal, #0fa676)" }}>country</Link> or{" "}
          <Link href="/regulator" style={{ color: "var(--teal, #0fa676)" }}>regulator</Link>.
        </p>

        {top.length > 0 ? (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 10 }}>
            {top.map((d) => (
              <li key={d.id} style={{ border: "1px solid var(--app-border)", borderRadius: 10 }}>
                <Link
                  href={`/medicine/${slugify(d.generic_name)}`}
                  style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, padding: "12px 14px", textDecoration: "none", color: "var(--app-text)" }}
                >
                  <span style={{ fontSize: 14, fontWeight: 500 }}>{d.generic_name}</span>
                  <span style={{ fontSize: 12, color: "#b42318", whiteSpace: "nowrap" }}>
                    {d.count} active
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p style={{ fontSize: 14, color: "var(--app-text-3)" }}>
            Live rankings are temporarily unavailable — try again shortly.
          </p>
        )}

        <div style={{ marginTop: 44, padding: "22px 26px", background: "var(--app-bg-2, #fafbfc)", border: "1px solid var(--app-border)", borderRadius: 14, textAlign: "center" }}>
          <p style={{ fontSize: 15, margin: "0 0 14px", color: "var(--app-text-2)" }}>
            Looking for a specific medicine? Search 17,000+ molecules and 160,000+ registered products.
          </p>
          <Link href="/signup" style={{ display: "inline-block", background: "var(--teal, #0fa676)", color: "#fff", padding: "10px 22px", borderRadius: 8, fontSize: 14, fontWeight: 600, textDecoration: "none" }}>
            Search free
          </Link>
        </div>
      </main>

      <MinimalFooter />
    </div>
  );
}
