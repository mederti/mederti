import HomeNavClient from "./home/HomeNavClient";
import LandingPageClient from "./components/landing-page-client";
import Link from "next/link";
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
          .lp-footer { flex-direction: column !important; gap: 12px !important; padding: 24px 20px !important; text-align: center !important; }
          .lp-footer-links { justify-content: center !important; }
          .lp-who-grid { grid-template-columns: 1fr !important; }
          .lp-steps-grid { grid-template-columns: repeat(2,1fr) !important; }
          .lp-step-cell { border-right: none !important; }
        }
      `}</style>

      {/* ── Same nav as /home ─────────────────────────────────── */}
      <HomeNavClient />

      {/* ── Hero + Chat + Content (all managed by client component) ── */}
      <LandingPageClient totalActive={totalActive} />

      {/* ── Footer ────────────────────────────────────────────── */}
      <footer className="lp-footer" style={{
        borderTop: "1px solid var(--app-border)",
        padding: "32px 24px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        maxWidth: 1200, margin: "0 auto",
      }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "var(--app-text)", letterSpacing: "-0.02em" }}>
          Mederti<span style={{ color: "var(--teal)" }}>.</span>
        </div>
        <div style={{ fontSize: 12, color: "var(--app-text-4)" }}>
          &copy; 2026 Mederti &middot; Global pharmaceutical shortage intelligence
        </div>
        <div className="lp-footer-links" style={{ display: "flex", gap: 20 }}>
          <a href="/privacy" style={{ fontSize: 12, color: "var(--app-text-4)", textDecoration: "none" }}>Privacy</a>
          <a href="/terms" style={{ fontSize: 12, color: "var(--app-text-4)", textDecoration: "none" }}>Terms</a>
          <a href="mailto:hello@mederti.com" style={{ fontSize: 12, color: "var(--app-text-4)", textDecoration: "none" }}>Contact</a>
          <a href="/dashboard" style={{ fontSize: 12, color: "var(--app-text-4)", textDecoration: "none" }}>Dashboard</a>
        </div>
      </footer>
    </div>
  );
}
