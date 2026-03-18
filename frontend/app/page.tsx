import SiteNav from "./components/landing-nav";
import SiteFooter from "./components/site-footer";
import LandingPageClient from "./components/landing-page-client";
import { MobileHome } from "./components/mobile/MobileHome";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getDevice } from "@/lib/get-device";

export const revalidate = 300; // 5 min ISR

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

  // Fetch live stats from Supabase (same source as dashboard)
  let totalActive = "8,100";
  let countryCount = "20";
  let sourceCount = "30";
  try {
    const admin = getSupabaseAdmin();
    const [activeRes, countriesRes, sourcesRes] = await Promise.all([
      admin.from("shortage_events").select("id", { count: "exact", head: true }).eq("status", "active"),
      admin.from("shortage_events").select("country_code").eq("status", "active"),
      admin.from("data_sources").select("id", { count: "exact", head: true }),
    ]);
    if (activeRes.count) totalActive = activeRes.count.toLocaleString();
    if (countriesRes.data) {
      const unique = new Set(countriesRes.data.map((r: { country_code: string }) => r.country_code).filter(Boolean));
      countryCount = String(unique.size);
    }
    if (sourcesRes.count) sourceCount = String(sourcesRes.count);
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
        }
      `}</style>

      {/* ── Landing page nav (Heidi-style layout) ────────────────── */}
      <SiteNav />

      {/* ── Hero + Chat + Content (all managed by client component) ── */}
      <LandingPageClient totalActive={totalActive} countryCount={countryCount} sourceCount={sourceCount} />

      <SiteFooter />
    </div>
  );
}
