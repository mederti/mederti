import SiteNav from "./components/landing-nav";
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
          .lp-who-grid { grid-template-columns: 1fr !important; }
          .lp-steps-grid { grid-template-columns: repeat(2,1fr) !important; }
          .lp-step-cell { border-right: none !important; }
        }
      `}</style>

      {/* ── Landing page nav (Heidi-style layout) ────────────────── */}
      <SiteNav />

      {/* ── Hero + Chat + Content (all managed by client component) ── */}
      <LandingPageClient totalActive={totalActive} />

      {/* ── Large Footer ──────────────────────────────────────── */}
      <footer style={{ background: "var(--app-bg)", borderTop: "1px solid var(--app-border)" }}>
        <div className="lp-footer-inner" style={{
          maxWidth: 1200, margin: "0 auto", padding: "72px 32px 0",
        }}>
          {/* ── Top: columns ── */}
          <div className="lp-footer-grid" style={{
            display: "grid",
            gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr",
            gap: 48,
            paddingBottom: 56,
          }}>
            {/* Brand column */}
            <div>
              <img src="/logo-black.png" alt="Mederti" style={{ height: 30, marginBottom: 20 }} />
              <p style={{ fontSize: 13, lineHeight: 1.7, color: "#6b7280", maxWidth: 280, margin: 0 }}>
                Global pharmaceutical shortage intelligence. Real-time data from 30+ regulatory sources across 20 countries.
              </p>
              <div style={{ display: "flex", gap: 12, marginTop: 24 }}>
                <a href="https://twitter.com/mederti" aria-label="Twitter" style={{ color: "#9ca3af", transition: "color 0.15s" }}>
                  <svg width="18" height="18" fill="currentColor" viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                </a>
                <a href="https://linkedin.com/company/mederti" aria-label="LinkedIn" style={{ color: "#9ca3af", transition: "color 0.15s" }}>
                  <svg width="18" height="18" fill="currentColor" viewBox="0 0 24 24"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
                </a>
                <a href="mailto:hello@mederti.com" aria-label="Email" style={{ color: "#9ca3af", transition: "color 0.15s" }}>
                  <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75"/></svg>
                </a>
              </div>
            </div>

            {/* Product */}
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "#9ca3af", marginBottom: 16 }}>Product</div>
              <nav style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <a href="/dashboard" style={{ fontSize: 13, color: "#6b7280", textDecoration: "none" }}>Dashboard</a>
                <a href="/search" style={{ fontSize: 13, color: "#6b7280", textDecoration: "none" }}>Drug Search</a>
                <a href="/shortages" style={{ fontSize: 13, color: "#6b7280", textDecoration: "none" }}>Shortages</a>
                <a href="/recalls" style={{ fontSize: 13, color: "#6b7280", textDecoration: "none" }}>Recalls</a>
                <a href="/alerts" style={{ fontSize: 13, color: "#6b7280", textDecoration: "none" }}>Alerts</a>
                <a href="/chat" style={{ fontSize: 13, color: "#6b7280", textDecoration: "none" }}>AI Chat</a>
              </nav>
            </div>

            {/* Company */}
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "#9ca3af", marginBottom: 16 }}>Company</div>
              <nav style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <a href="/about" style={{ fontSize: 13, color: "#6b7280", textDecoration: "none" }}>About</a>
                <a href="/pricing" style={{ fontSize: 13, color: "#6b7280", textDecoration: "none" }}>Pricing</a>
                <a href="/contact" style={{ fontSize: 13, color: "#6b7280", textDecoration: "none" }}>Contact</a>
                <a href="mailto:hello@mederti.com" style={{ fontSize: 13, color: "#6b7280", textDecoration: "none" }}>hello@mederti.com</a>
              </nav>
            </div>

            {/* Resources */}
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "#9ca3af", marginBottom: 16 }}>Resources</div>
              <nav style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <a href="/home" style={{ fontSize: 13, color: "#6b7280", textDecoration: "none" }}>News Feed</a>
                <a href="/watchlist" style={{ fontSize: 13, color: "#6b7280", textDecoration: "none" }}>Watchlist</a>
                <a href="/dashboard" style={{ fontSize: 13, color: "#6b7280", textDecoration: "none" }}>Data Sources</a>
              </nav>
            </div>

            {/* Legal */}
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "#9ca3af", marginBottom: 16 }}>Legal</div>
              <nav style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <a href="/privacy" style={{ fontSize: 13, color: "#6b7280", textDecoration: "none" }}>Privacy Policy</a>
                <a href="/terms" style={{ fontSize: 13, color: "#6b7280", textDecoration: "none" }}>Terms of Service</a>
              </nav>
            </div>
          </div>

          {/* ── Bottom bar ── */}
          <div style={{
            borderTop: "1px solid var(--app-border)",
            padding: "24px 0",
            display: "flex", alignItems: "center", justifyContent: "space-between",
          }}>
            <div style={{ fontSize: 12, color: "#9ca3af" }}>
              &copy; 2026 Mederti Pty Ltd. All rights reserved.
            </div>
            <div style={{ fontSize: 12, color: "#b0b5bf" }}>
              Melbourne, Australia
            </div>
          </div>
        </div>

        <style>{`
          @media (max-width: 768px) {
            .lp-footer-inner { padding: 48px 20px 0 !important; }
            .lp-footer-grid {
              grid-template-columns: 1fr 1fr !important;
              gap: 36px 24px !important;
            }
            .lp-footer-grid > div:first-child {
              grid-column: 1 / -1;
            }
          }
          @media (max-width: 480px) {
            .lp-footer-grid {
              grid-template-columns: 1fr !important;
            }
          }
        `}</style>
      </footer>
    </div>
  );
}
