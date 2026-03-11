import SiteNav from "./components/landing-nav";
import SiteFooter from "./components/site-footer";
import LandingPageClient from "./components/landing-page-client";
import { redirect } from "next/navigation";
import { api } from "@/lib/api";
import { createServerClient } from "@/lib/supabase/server";

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

  // Fetch live stats for trust bar
  let totalActive = "12,400";
  try {
    const summary = await api.getSummary();
    if (summary?.total_active) totalActive = summary.total_active.toLocaleString();
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
      <LandingPageClient totalActive={totalActive} />

      <SiteFooter />
    </div>
  );
}
