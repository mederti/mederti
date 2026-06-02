import type { Metadata } from "next";
import SiteNav from "./components/landing-nav";
import SiteFooter from "./components/site-footer";
import LandingPageClient from "./components/landing-page-client";
import { MobileHome } from "./components/mobile/MobileHome";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getDevice } from "@/lib/get-device";

export const revalidate = 300; // 5 min ISR

export const metadata: Metadata = {
  title: "Mederti — Global Drug Shortage Intelligence Platform",
  description:
    "Real-time pharmaceutical shortage tracking across major markets. 216,000+ drugs monitored. TGA, FDA, MHRA, EMA and more regulatory sources. Used by pharmacists, hospitals, and health systems.",
  keywords: ["drug shortage", "medicine shortage", "pharmaceutical shortage", "TGA shortage", "FDA drug shortage", "MHRA shortage", "medicine availability"],
  openGraph: {
    title: "Mederti — Global Drug Shortage Intelligence",
    description:
      "Track drug shortages across major markets in real time. 216,000+ drugs monitored from regulatory sources worldwide.",
    url: "https://mederti.vercel.app",
    siteName: "Mederti",
    type: "website",
  },
  alternates: {
    canonical: "https://mederti.vercel.app",
  },
};

export default async function Home() {
  // If logged in, redirect to /home
  try {
    const supabase = await createServerClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (session) redirect("/home");
  } catch (e) {
    // redirect() throws a special error — re-throw it
    if (e && typeof e === "object" && "digest" in e) throw e;
    // Otherwise ignore auth errors and show landing page
  }

  // Mobile → completely different layout
  const device = await getDevice();
  if (device === "mobile") {
    return <MobileHome />;
  }

  // Live stats from Supabase are the SINGLE source of truth (same source as the
  // dashboard). These fallbacks only render if the fetch below throws — kept as
  // a neutral "—" rather than a stale specific number so a Supabase hiccup never
  // shows a confidently-wrong figure on a clinician-facing homepage.
  let totalActive = "—";
  let countryCount = "—";
  let sourceCount = "—";
  let platformStats = {
    totalCatalogue: 216509,
    totalShortages: 21550,
    activeShortages: 15132,
    anticipatedShortages: 1444,
    totalRecalls: 23495,
    countries: 22,
    sources: 47,
    scrapers: 47,
  };
  try {
    const admin = getSupabaseAdmin();
    const [activeRes, countriesRes, sourcesRes, totalRes, anticipatedRes, recallsRes, catalogueRes] = await Promise.all([
      admin.from("shortage_events").select("id", { count: "exact", head: true }).eq("status", "active"),
      // Live country count: only countries with shortage rows in the last 30 days.
      // data_sources.country_code includes broken scrapers that haven't produced rows.
      admin.from("shortage_events").select("country_code").gte("created_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()),
      admin.from("data_sources").select("id", { count: "exact", head: true }),
      admin.from("shortage_events").select("id", { count: "exact", head: true }),
      admin.from("shortage_events").select("id", { count: "exact", head: true }).eq("status", "anticipated"),
      admin.from("recalls").select("id", { count: "exact", head: true }),
      admin.from("drug_products").select("id", { count: "exact", head: true }),
    ]);
    if (activeRes.count) totalActive = activeRes.count.toLocaleString();
    if (countriesRes.data) {
      const unique = new Set(countriesRes.data.map((r: { country_code: string }) => r.country_code).filter(Boolean));
      countryCount = String(unique.size);
    }
    if (sourcesRes.count) sourceCount = String(sourcesRes.count);
    platformStats = {
      totalCatalogue: catalogueRes.count ?? platformStats.totalCatalogue,
      totalShortages: totalRes.count ?? platformStats.totalShortages,
      activeShortages: activeRes.count ?? platformStats.activeShortages,
      anticipatedShortages: anticipatedRes.count ?? platformStats.anticipatedShortages,
      totalRecalls: recallsRes.count ?? platformStats.totalRecalls,
      countries: countriesRes.data ? new Set(countriesRes.data.map((r: { country_code: string }) => r.country_code).filter(Boolean)).size : platformStats.countries,
      sources: sourcesRes.count ?? platformStats.sources,
      scrapers: 47,
    };
  } catch { /* fallback to static */ }

  return (
    <div style={{ background: "var(--app-bg)", color: "var(--app-text)", minHeight: "100vh" }}>
      <style>{`
        @keyframes blink { 0%,100% { opacity:1 } 50% { opacity:0.35 } }
        @media (max-width: 768px) {
          .lp-hero { padding: 24px 16px 20px !important; }
          .lp-trust-bar { flex-wrap: wrap !important; gap: 8px !important; }
          .lp-stats-grid { grid-template-columns: repeat(2,1fr) !important; }
          .lp-stat-cell { border-right: none !important; border-bottom: 1px solid var(--app-border) !important; padding: 28px 24px !important; }
          .lp-how-grid { grid-template-columns: 1fr !important; }
          .lp-section { padding: 60px 20px !important; }
          .lp-pricing-cards { grid-template-columns: 1fr !important; max-width: 400px !important; margin: 0 auto !important; }
          .lp-brief-grid { grid-template-columns: 1fr !important; gap: 40px !important; }
          .lp-who-grid { grid-template-columns: 1fr !important; }
          .lp-steps-grid { grid-template-columns: repeat(2,1fr) !important; }
          .lp-step-cell { border-right: none !important; }
          .lp-stats-cards { grid-template-columns: repeat(2,1fr) !important; }
        }
      `}</style>

      {/* ── Landing page nav (Heidi-style layout) ────────────────── */}
      <SiteNav />

      {/* ── Hero + Chat + Content (all managed by client component) ── */}
      <LandingPageClient totalActive={totalActive} countryCount={countryCount} sourceCount={sourceCount} platformStats={platformStats} />

      <SiteFooter />
    </div>
  );
}
