import { EmailCapture } from "./components/email-capture";
import HomeNavClient from "./home/HomeNavClient";
import HomeSearchClient from "./home/HomeSearchClient";
import Link from "next/link";
import { api } from "@/lib/api";

function Dot({ color }: { color: "red" | "amber" | "green" }) {
  const bg =
    color === "red" ? "var(--crit)" : color === "amber" ? "var(--med)" : "var(--low)";
  return (
    <span style={{ width: 6, height: 6, borderRadius: "50%", background: bg, display: "inline-block", flexShrink: 0 }} />
  );
}

export const revalidate = 300; // 5 min ISR

export default async function Home() {
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

      {/* ── Same nav as /home ──────────────────────────────────────────── */}
      <HomeNavClient />

      {/* ── Hero: same dark navy band as /home ─────────────────────────── */}
      <div className="lp-hero" style={{
        background: "var(--navy)",
        padding: "36px 24px 32px",
        display: "flex", flexDirection: "column", alignItems: "center", gap: 20,
      }}>
        <div style={{ textAlign: "center", maxWidth: 900 }}>
          <h1 style={{
            fontSize: 42, fontWeight: 700, color: "#fff",
            letterSpacing: "-0.03em", lineHeight: 1.2, marginBottom: 8,
          }}>
            Find Short-Supply Medicines Globally.
          </h1>
          <p style={{ fontSize: 15, color: "rgba(255,255,255,0.5)", lineHeight: 1.5 }}>
            Real-time shortages, recalls, and alternatives across 30 regulatory sources.
          </p>
        </div>

        <HomeSearchClient />

        {/* Trust bar */}
        <div className="lp-trust-bar" style={{
          display: "flex", alignItems: "center", gap: 24, flexWrap: "nowrap",
        }}>
          {[
            { val: totalActive, label: "active shortages", href: "/shortages?status=active" },
            { val: "30",   label: "regulatory sources", href: "/shortages" },
            { val: "11",   label: "countries",          href: "/shortages" },
            { val: "live", label: "data feed",          href: "/shortages" },
          ].map(({ val, label, href }) => (
            <Link key={label} href={href} style={{
              display: "flex", alignItems: "center", gap: 6,
              fontSize: 12, color: "rgba(255,255,255,0.45)",
              textDecoration: "none",
            }}>
              <span style={{
                fontFamily: "var(--font-dm-mono), monospace",
                color: "rgba(255,255,255,0.75)", fontWeight: 500,
              }}>{val}</span>
              {label}
            </Link>
          ))}
        </div>
      </div>

      {/* ── Content area (logged-out landing content) ──────────────────── */}
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 24px 0" }}>

        {/* PRODUCT PREVIEW */}
        <div style={{ padding: "48px 0 64px" }}>
          <div style={{ textAlign: "center", marginBottom: 36 }}>
            <div style={{ fontSize: 11, fontWeight: 500, letterSpacing: "0.10em", textTransform: "uppercase", color: "var(--teal)", marginBottom: 10 }}>
              The platform
            </div>
            <h2 style={{
              fontSize: "clamp(24px,3.5vw,36px)", fontWeight: 700,
              lineHeight: 1.15, letterSpacing: "-0.025em",
              color: "var(--app-text)", margin: "0 auto",
            }}>
              Built for decisions, not just awareness.
            </h2>
          </div>

          <div style={{
            border: "1px solid var(--app-border)", borderRadius: 14, overflow: "hidden",
            background: "#fff",
            boxShadow: "0 8px 48px rgba(15,23,42,0.08), 0 2px 8px rgba(15,23,42,0.04)",
            maxWidth: 1000, margin: "0 auto",
          }}>
            {/* Browser bar */}
            <div style={{
              background: "var(--app-bg)", padding: "12px 18px",
              display: "flex", alignItems: "center", gap: 10,
              borderBottom: "1px solid var(--app-border)",
            }}>
              {["#ef4444", "#f97316", "#22c55e"].map((c) => (
                <span key={c} style={{ width: 10, height: 10, borderRadius: "50%", background: c, display: "inline-block", opacity: 0.7 }} />
              ))}
              <span style={{
                flex: 1, background: "#fff", border: "1px solid var(--app-border)",
                borderRadius: 5, padding: "4px 12px", fontSize: 12, color: "var(--app-text-4)",
                fontFamily: "var(--font-dm-mono), monospace", maxWidth: 280,
              }}>
                app.mederti.com/dashboard
              </span>
            </div>

            <div style={{ padding: "24px 28px" }}>
              {/* KPI row */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 16 }}>
                {[
                  { label: "Critical shortages", val: "23", delta: "↑ 4 since last month", accent: "var(--crit)" },
                  { label: "High severity", val: "41", delta: "↑ 7 since last month", accent: "var(--high)" },
                  { label: "New this month", val: "18", delta: "↑ 3 vs Feb 2025", accent: "var(--med)" },
                  { label: "AI early warnings", val: "8", delta: "Next 30–60 days", accent: "var(--teal)" },
                ].map((k) => (
                  <div key={k.label} style={{
                    background: "var(--app-bg)", border: "1px solid var(--app-border)",
                    borderRadius: 8, padding: "14px 16px", position: "relative", overflow: "hidden",
                  }}>
                    <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: k.accent }} />
                    <div style={{ fontSize: 10, color: "var(--app-text-4)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>{k.label}</div>
                    <div style={{ fontFamily: "var(--font-dm-mono), monospace", fontSize: 26, fontWeight: 500, lineHeight: 1, color: k.accent }}>{k.val}</div>
                    <div style={{ fontSize: 11, color: "var(--app-text-4)", marginTop: 4 }}>{k.delta}</div>
                  </div>
                ))}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div style={{ background: "var(--app-bg)", border: "1px solid var(--app-border)", borderRadius: 8, padding: "14px 16px" }}>
                  <div style={{ fontSize: 10, color: "var(--app-text-4)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 10 }}>Active critical shortages</div>
                  {[
                    { drug: "Amoxicillin 500mg", sev: "Critical", color: "var(--crit)", bg: "var(--crit-bg)" },
                    { drug: "Cisplatin 1mg/ml", sev: "Critical", color: "var(--crit)", bg: "var(--crit-bg)" },
                    { drug: "Paracetamol IV 10mg/ml", sev: "Critical", color: "var(--crit)", bg: "var(--crit-bg)" },
                    { drug: "Lithium Carbonate 250mg", sev: "High", color: "var(--high)", bg: "var(--high-bg)" },
                    { drug: "Atorvastatin 40mg", sev: "High", color: "var(--high)", bg: "var(--high-bg)" },
                  ].map((row) => (
                    <div key={row.drug} style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      padding: "7px 0", borderBottom: "1px solid var(--app-border)",
                    }}>
                      <span style={{ fontSize: 12, color: "var(--app-text)" }}>{row.drug}</span>
                      <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 6px", borderRadius: 3, background: row.bg, color: row.color }}>{row.sev}</span>
                    </div>
                  ))}
                </div>
                <div style={{ background: "var(--app-bg)", border: "1px solid var(--app-border)", borderRadius: 8, padding: "14px 16px" }}>
                  <div style={{ fontSize: 10, color: "var(--app-text-4)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 10 }}>⚠ Early warning signals</div>
                  {[
                    { icon: "🏭", text: "Ciprofloxacin 500mg — Aurobindo facility flagged by FDA inspection", badge: "HIGH RISK", color: "var(--high)", bg: "var(--high-bg)" },
                    { icon: "✦", text: "Metformin 500mg — AI pattern match with current 850mg shortage", badge: "AI SIGNAL", color: "var(--indigo)", bg: "var(--ind-bg)" },
                    { icon: "🏭", text: "Flucloxacillin — NMPA China manufacturing suspension flagged", badge: "HIGH RISK", color: "var(--high)", bg: "var(--high-bg)" },
                  ].map((w) => (
                    <div key={w.text} style={{ display: "flex", gap: 10, padding: "8px 0", borderBottom: "1px solid var(--app-border)", alignItems: "flex-start" }}>
                      <span style={{ fontSize: 13, flexShrink: 0 }}>{w.icon}</span>
                      <span style={{ fontSize: 11, color: "var(--app-text-2)", lineHeight: 1.5, flex: 1 }}>{w.text}</span>
                      <span style={{ fontSize: 9, fontWeight: 600, padding: "2px 6px", borderRadius: 3, background: w.bg, color: w.color, whiteSpace: "nowrap", flexShrink: 0 }}>{w.badge}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* WHO IT'S FOR */}
        <section id="who" style={{ padding: "48px 0 64px" }}>
          <div style={{ textAlign: "center", marginBottom: 40 }}>
            <div style={{ fontSize: 11, fontWeight: 500, letterSpacing: "0.10em", textTransform: "uppercase", color: "var(--teal)", marginBottom: 10 }}>
              Who it&apos;s for
            </div>
            <h2 style={{ fontSize: "clamp(24px,3.5vw,36px)", fontWeight: 700, lineHeight: 1.15, letterSpacing: "-0.025em", color: "var(--app-text)", maxWidth: 560, margin: "0 auto 12px" }}>
              Every part of the supply chain, served differently.
            </h2>
            <p style={{ fontSize: 15, color: "var(--app-text-3)", maxWidth: 500, lineHeight: 1.65, margin: "0 auto" }}>
              Three views of the same data — built for how each user actually works.
            </p>
          </div>

          <div className="lp-who-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
            {[
              {
                icon: "💊",
                title: "Pharmacists & Clinicians",
                desc: "Fast answers at the dispensary counter. Is it available? When is it back? What can I use instead?",
                features: ["Real-time availability by country", "AI-matched therapeutic alternatives", "Alert when stock returns", "Mobile-optimised interface"],
              },
              {
                icon: "🏥",
                title: "Hospital Procurement",
                desc: "Comprehensive shortage intelligence with source data, confidence scores and procurement guidance.",
                features: ["Full source audit trail", "Manufacturer & supplier data", "Watchlist & bulk alerts", "Exportable reports"],
              },
              {
                icon: "🏛",
                title: "Regulators & Government",
                desc: "Market-wide intelligence. Early warning signals. Policy-ready reporting. Know before the calls come in.",
                features: ["National supply heatmaps", "AI early warning — 30–90 day forecasts", "Global comparison view", "One-click ministerial briefings"],
              },
            ].map((card) => (
              <div key={card.title} style={{ background: "#fff", border: "1px solid var(--app-border)", borderRadius: 12, padding: "28px 24px" }}>
                <div style={{ fontSize: 24, marginBottom: 12 }}>{card.icon}</div>
                <div style={{ fontSize: 15, fontWeight: 600, color: "var(--app-text)", marginBottom: 8, letterSpacing: "-0.01em" }}>{card.title}</div>
                <div style={{ fontSize: 13, color: "var(--app-text-3)", lineHeight: 1.65, marginBottom: 16 }}>{card.desc}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                  {card.features.map((f) => (
                    <div key={f} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--app-text-3)" }}>
                      <span style={{ color: "var(--teal)", fontSize: 11, flexShrink: 0 }}>→</span>
                      {f}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* HOW IT WORKS */}
        <section id="how" style={{ padding: "48px 0 64px" }}>
          <div style={{ textAlign: "center", marginBottom: 40 }}>
            <div style={{ fontSize: 11, fontWeight: 500, letterSpacing: "0.10em", textTransform: "uppercase", color: "var(--teal)", marginBottom: 10 }}>
              How it works
            </div>
            <h2 style={{ fontSize: "clamp(24px,3.5vw,36px)", fontWeight: 700, lineHeight: 1.15, letterSpacing: "-0.025em", color: "var(--app-text)", maxWidth: 560, margin: "0 auto 12px" }}>
              From regulatory source to actionable intelligence.
            </h2>
            <p style={{ fontSize: 15, color: "var(--app-text-3)", maxWidth: 500, lineHeight: 1.65, margin: "0 auto" }}>
              Fully automated data pipeline with expert human curation on top.
            </p>
          </div>

          <div className="lp-steps-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 0, border: "1px solid var(--app-border)", borderRadius: 12, overflow: "hidden" }}>
            {[
              { num: "01", title: "Collect", desc: "Daily automated scraping of 50+ regulatory bodies — TGA, FDA, MHRA, EMA, Health Canada and more across 9 countries." },
              { num: "02", title: "Normalise", desc: "Raw data is cleaned, deduplicated, classified by severity and cross-referenced across sources to build confidence scores." },
              { num: "03", title: "Enrich", desc: "AI layer adds resolution forecasts, therapeutic alternatives, supply-chain origin analysis and early warning signals." },
              { num: "04", title: "Verify", desc: "20 years of pharmaceutical supply chain expertise applied as expert commentary and confidence overrides on key shortages." },
            ].map((step, i) => (
              <div key={step.num} className="lp-step-cell" style={{
                padding: "28px 24px",
                background: "#fff",
                borderRight: i < 3 ? "1px solid var(--app-border)" : "none",
              }}>
                <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", color: "var(--teal)", marginBottom: 16 }}>
                  {step.num}
                </div>
                <div style={{ fontSize: 15, fontWeight: 600, color: "var(--app-text)", marginBottom: 10, letterSpacing: "-0.01em" }}>{step.title}</div>
                <div style={{ fontSize: 13, color: "var(--app-text-3)", lineHeight: 1.65 }}>{step.desc}</div>
              </div>
            ))}
          </div>
        </section>

        {/* PRICING */}
        <section id="pricing" style={{ padding: "48px 0 64px" }}>
          <div style={{ textAlign: "center", marginBottom: 40 }}>
            <div style={{ fontSize: 11, fontWeight: 500, letterSpacing: "0.10em", textTransform: "uppercase", color: "var(--teal)", marginBottom: 10 }}>
              Pricing
            </div>
            <h2 style={{ fontSize: "clamp(24px,3.5vw,36px)", fontWeight: 700, lineHeight: 1.15, letterSpacing: "-0.025em", color: "var(--app-text)", maxWidth: 560, margin: "0 auto 12px" }}>
              Start free. Scale when it matters.
            </h2>
            <p style={{ fontSize: 15, color: "var(--app-text-3)", maxWidth: 500, lineHeight: 1.65, margin: "0 auto" }}>
              Free for individual pharmacists. Institutional pricing for procurement teams and government.
            </p>
          </div>

          <div className="lp-pricing-cards" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16, maxWidth: 960, margin: "0 auto" }}>
            {/* Free */}
            <div style={{ background: "#fff", border: "1px solid var(--app-border)", borderRadius: 12, padding: "32px 28px", textAlign: "left" }}>
              <div style={{ fontSize: 12, fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--app-text-4)", marginBottom: 16 }}>Free</div>
              <div style={{ fontSize: 40, fontWeight: 700, color: "var(--app-text)", lineHeight: 1, marginBottom: 4, letterSpacing: "-0.02em" }}>
                $0<span style={{ fontSize: 16, color: "var(--app-text-4)", fontWeight: 400 }}>/mo</span>
              </div>
              <div style={{ fontSize: 13, color: "var(--app-text-4)", marginBottom: 28, paddingBottom: 28, borderBottom: "1px solid var(--app-border)" }}>
                For individual pharmacists and clinicians
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 28 }}>
                {["Drug shortage search", "5 country availability view", "Basic alternative suggestions", "3 drug watchlist alerts", "Weekly shortage brief"].map((f) => (
                  <div key={f} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "var(--app-text-2)" }}>
                    <span style={{ color: "var(--teal)", flexShrink: 0 }}>✓</span>
                    {f}
                  </div>
                ))}
              </div>
              <button style={{
                width: "100%", padding: "11px", borderRadius: 8,
                fontSize: 13, fontWeight: 500, fontFamily: "var(--font-inter), sans-serif",
                cursor: "pointer", textAlign: "center",
                background: "#fff", border: "1px solid var(--app-border-2)", color: "var(--app-text-2)",
              }}>
                Get started free
              </button>
            </div>

            {/* Pro */}
            <div style={{
              background: "var(--app-text)", border: "1px solid var(--app-text)",
              borderRadius: 12, padding: "32px 28px", position: "relative", textAlign: "left",
            }}>
              <div style={{
                position: "absolute", top: -1, left: "50%", transform: "translateX(-50%)",
                fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase",
                background: "var(--teal)", color: "#fff", padding: "4px 14px", borderRadius: "0 0 8px 8px",
              }}>
                Most popular
              </div>
              <div style={{ fontSize: 12, fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: "rgba(255,255,255,0.4)", marginBottom: 16 }}>Pro</div>
              <div style={{ fontSize: 40, fontWeight: 700, color: "#fff", lineHeight: 1, marginBottom: 4, letterSpacing: "-0.02em" }}>
                $800<span style={{ fontSize: 16, color: "rgba(255,255,255,0.4)", fontWeight: 400 }}>/mo</span>
              </div>
              <div style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", marginBottom: 28, paddingBottom: 28, borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
                Per institution · hospital, pharmacy group or distributor
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 28 }}>
                {[
                  "Everything in Free", "Full analyst view with source data", "Unlimited watchlist alerts",
                  "6-hourly data refresh", "AI shortage assistant", "Exportable PDF reports",
                  "Expert curator commentary", "Up to 20 team seats",
                ].map((f) => (
                  <div key={f} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "rgba(255,255,255,0.75)" }}>
                    <span style={{ color: "var(--teal)", flexShrink: 0 }}>✓</span>
                    {f}
                  </div>
                ))}
              </div>
              <button style={{
                width: "100%", padding: "11px", borderRadius: 8,
                fontSize: 13, fontWeight: 600, fontFamily: "var(--font-inter), sans-serif",
                cursor: "pointer", textAlign: "center",
                background: "var(--teal)", border: "none", color: "#fff",
              }}>
                Start free trial
              </button>
            </div>

            {/* Enterprise */}
            <div style={{ background: "#fff", border: "1px solid var(--app-border)", borderRadius: 12, padding: "32px 28px", textAlign: "left" }}>
              <div style={{ fontSize: 12, fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--app-text-4)", marginBottom: 16 }}>Enterprise</div>
              <div style={{ fontSize: 34, fontWeight: 700, color: "var(--app-text)", lineHeight: 1, marginBottom: 4, letterSpacing: "-0.02em" }}>Custom</div>
              <div style={{ fontSize: 13, color: "var(--app-text-4)", marginBottom: 28, paddingBottom: 28, borderBottom: "1px solid var(--app-border)" }}>
                For regulators, health ministries and large distributors
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 28 }}>
                {[
                  "Everything in Pro", "National supply dashboard", "AI early warning system",
                  "Ministerial briefing generator", "Hourly refresh", "Dedicated data analyst",
                  "API access", "SLA + compliance docs",
                ].map((f) => (
                  <div key={f} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "var(--app-text-2)" }}>
                    <span style={{ color: "var(--teal)", flexShrink: 0 }}>✓</span>
                    {f}
                  </div>
                ))}
              </div>
              <button style={{
                width: "100%", padding: "11px", borderRadius: 8,
                fontSize: 13, fontWeight: 500, fontFamily: "var(--font-inter), sans-serif",
                cursor: "pointer", textAlign: "center",
                background: "#fff", border: "1px solid var(--app-border-2)", color: "var(--app-text-2)",
              }}>
                Talk to us →
              </button>
            </div>
          </div>
        </section>

        {/* WEEKLY BRIEF */}
        <section id="brief" style={{ padding: "48px 0 64px" }}>
          <div className="lp-brief-grid" style={{
            display: "grid", gridTemplateColumns: "1fr 1fr", gap: 48, alignItems: "center",
            maxWidth: 960, margin: "0 auto",
          }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 500, letterSpacing: "0.10em", textTransform: "uppercase", color: "var(--teal)", marginBottom: 12 }}>
                Weekly brief
              </div>
              <h2 style={{ fontSize: "clamp(22px,3vw,32px)", fontWeight: 700, lineHeight: 1.2, letterSpacing: "-0.025em", color: "var(--app-text)", marginBottom: 12 }}>
                The shortage intelligence your inbox has been missing.
              </h2>
              <p style={{ fontSize: 14, color: "var(--app-text-3)", lineHeight: 1.7, marginBottom: 6 }}>
                Every Monday — new shortages declared, resolutions expected, supply signals to watch. Written by AI, verified by 20 years of industry expertise.
              </p>
              <p style={{ fontSize: 12, color: "var(--app-text-4)", marginBottom: 24 }}>
                Free forever · No credit card · Unsubscribe anytime
              </p>
              <EmailCapture
                placeholder="your@hospital.com.au"
                btnText="Subscribe →"
                source="weekly_brief"
                small
              />
            </div>

            {/* Email preview */}
            <div style={{
              background: "#fff", border: "1px solid var(--app-border)",
              borderRadius: 12, overflow: "hidden",
              boxShadow: "0 4px 24px rgba(15,23,42,0.06)",
            }}>
              <div style={{
                background: "#fff", padding: "12px 16px",
                borderBottom: "1px solid var(--app-border)",
              }}>
                <div style={{ fontSize: 11, color: "var(--app-text-4)" }}>From: <strong style={{ color: "var(--app-text-2)" }}>Mederti Weekly · intelligence@mederti.com</strong></div>
                <div style={{ fontSize: 11, color: "var(--app-text-4)", marginTop: 2 }}>
                  Subject: <strong style={{ color: "var(--app-text)" }}>Week of 17 Feb 2026 — 5 new shortages, antibiotic crisis deepens</strong>
                </div>
              </div>
              <div style={{ padding: "0 16px 16px" }}>
                <div style={{ fontSize: 12, color: "var(--app-text-3)", lineHeight: 1.8, padding: "12px 0", borderBottom: "1px solid var(--app-border)" }}>
                  <strong style={{ color: "var(--app-text-2)" }}>This week across 9 countries:</strong> 5 new shortages declared · 2 resolved · Antibiotic category now at highest severity since 2023.
                </div>
                {[
                  { color: "red" as const, text: <><strong>New critical:</strong>&nbsp;Amoxicillin 500mg escalated in AU + UK</> },
                  { color: "amber" as const, text: <><strong>Watch:</strong>&nbsp;Ciprofloxacin — Indian API facility flagged</> },
                  { color: "green" as const, text: <><strong>Resolved:</strong>&nbsp;Metoprolol 50mg AU · Pantoprazole IV UK</> },
                  { color: "amber" as const, text: <><strong>Expert note:</strong>&nbsp;Aurobindo Gujarat situation worse than reported…</> },
                ].map((row, i) => (
                  <div key={i} style={{
                    display: "flex", alignItems: "center", gap: 8,
                    padding: "9px 0", borderBottom: i < 3 ? "1px solid var(--app-border)" : "none",
                    fontSize: 12, color: "var(--app-text-2)",
                  }}>
                    <Dot color={row.color} />
                    {row.text}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* EMAIL CAPTURE */}
        <div id="signup" style={{
          textAlign: "center", padding: "48px 24px",
          background: "#fff", border: "1px solid var(--app-border)", borderRadius: 12,
          marginBottom: 48,
        }}>
          <h2 style={{ fontSize: 22, fontWeight: 700, color: "var(--app-text)", marginBottom: 8, letterSpacing: "-0.02em" }}>
            Get early access
          </h2>
          <p style={{ fontSize: 14, color: "var(--app-text-3)", marginBottom: 24, maxWidth: 400, margin: "0 auto 24px" }}>
            Join pharmacists, procurement managers and regulators on the waitlist. Free to start.
          </p>
          <div style={{ maxWidth: 420, margin: "0 auto" }}>
            <EmailCapture />
          </div>
        </div>
      </div>

      {/* FOOTER */}
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
          © 2026 Mederti · Global pharmaceutical shortage intelligence
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
