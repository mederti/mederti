import { EmailCapture } from "./components/email-capture";
import { HeroSearch } from "./components/hero-search";
import { NavSearch } from "./components/nav-search";

const TICKER = [
  { color: "red", text: "Amoxicillin 500mg · AU · Critical" },
  { color: "red", text: "Cisplatin 1mg/ml · AU, UK, DE · Critical" },
  { color: "amber", text: "Metformin 850mg · AU, CA · High" },
  { color: "red", text: "Paracetamol IV 10mg/ml · AU, UK · Critical" },
  { color: "amber", text: "Atorvastatin 40mg · AU · High" },
  { color: "red", text: "Lithium Carbonate 250mg · Global · Critical" },
  { color: "amber", text: "Salbutamol inhaler · AU · Medium" },
  { color: "red", text: "Flucloxacillin 500mg · AU · High risk" },
];

function Dot({ color }: { color: "red" | "amber" | "green" }) {
  const bg =
    color === "red" ? "var(--crit)" : color === "amber" ? "var(--med)" : "var(--low)";
  return (
    <span style={{ width: 6, height: 6, borderRadius: "50%", background: bg, display: "inline-block", flexShrink: 0 }} />
  );
}

export default function Home() {
  const doubled = [...TICKER, ...TICKER];

  return (
    <div style={{ background: "#fff", color: "var(--app-text)", minHeight: "100vh", overflowX: "hidden" }}>
      <style>{`
        @media (max-width: 768px) {
          .lp-nav { padding: 0 16px !important; }
          .lp-nav-links { display: none !important; }
          .lp-hero { padding: 90px 20px 80px !important; }
          .lp-hero h1 { font-size: 36px !important; }
          .lp-stats-grid { grid-template-columns: repeat(2,1fr) !important; }
          .lp-stat-cell { border-right: none !important; border-bottom: 1px solid var(--app-border) !important; padding: 28px 24px !important; }
          .lp-how-grid { grid-template-columns: 1fr !important; }
          .lp-section { padding: 60px 20px !important; }
          .lp-pricing-cards { grid-template-columns: 1fr !important; max-width: 400px !important; margin: 0 auto !important; }
          .lp-brief-grid { grid-template-columns: 1fr !important; gap: 40px !important; }
          .lp-footer { flex-direction: column !important; gap: 12px !important; padding: 24px 20px !important; text-align: center !important; }
          .lp-footer-links { justify-content: center !important; }
          .lp-ticker { display: none !important; }
        }
      `}</style>

      {/* NAV */}
      <nav className="lp-nav" style={{
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 100,
        height: 60,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 48px",
        background: "rgba(255,255,255,0.90)",
        backdropFilter: "blur(12px)",
        borderBottom: "1px solid var(--app-border)",
      }}>
        <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.03em", color: "var(--app-text)" }}>
          Mederti<span style={{ color: "var(--teal)" }}>.</span>
        </div>
        <NavSearch />
        <div className="lp-nav-links" style={{ display: "flex", alignItems: "center", gap: 24, flexShrink: 0 }}>
          {[["How it works", "#how"], ["Pricing", "#pricing"]].map(([l, h]) => (
            <a key={l} href={h} style={{ fontSize: 13, color: "var(--app-text-3)", textDecoration: "none", whiteSpace: "nowrap" }}>
              {l}
            </a>
          ))}
        </div>
        <a href="#signup" style={{
          fontSize: 13, fontWeight: 500, padding: "8px 16px",
          background: "var(--app-text)", color: "#fff", borderRadius: 6,
          textDecoration: "none", whiteSpace: "nowrap", flexShrink: 0,
        }}>
          Get early access
        </a>
      </nav>

      {/* HERO */}
      <section className="lp-hero" style={{
        minHeight: "100vh",
        display: "flex", flexDirection: "column", justifyContent: "center",
        padding: "120px 48px 100px",
        position: "relative", overflow: "hidden",
        borderBottom: "1px solid var(--app-border)",
      }}>
        {/* Subtle grid */}
        <div aria-hidden style={{
          position: "absolute", inset: 0, zIndex: 0, opacity: 0.4,
          backgroundImage: "linear-gradient(var(--app-border) 1px, transparent 1px), linear-gradient(90deg, var(--app-border) 1px, transparent 1px)",
          backgroundSize: "72px 72px",
        }} />
        {/* Teal glow — very subtle */}
        <div aria-hidden style={{
          position: "absolute", top: "20%", right: "10%", zIndex: 0,
          width: 600, height: 600, borderRadius: "50%",
          background: "radial-gradient(circle, rgba(13,148,136,0.06) 0%, transparent 70%)",
          pointerEvents: "none",
        }} />

        <div style={{ position: "relative", zIndex: 1, maxWidth: 800, margin: "0 auto", textAlign: "center" }}>
          {/* Eyebrow */}
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 8,
            fontSize: 11, fontWeight: 500, letterSpacing: "0.10em", textTransform: "uppercase",
            color: "var(--teal)", marginBottom: 32,
            padding: "6px 14px", border: "1px solid rgba(13,148,136,0.25)", borderRadius: 4,
            background: "rgba(13,148,136,0.05)",
          }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--teal)", animation: "blink 1.6s ease-in-out infinite", display: "inline-block" }} />
            Live · 12,400 shortage records · 9 countries
          </div>

          <h1 style={{
            fontSize: "clamp(44px, 6vw, 76px)",
            fontWeight: 700,
            lineHeight: 1.04,
            letterSpacing: "-0.03em",
            color: "var(--app-text)",
            marginBottom: 28,
          }}>
            The world&apos;s drug<br />
            shortages —<br />
            <span style={{ color: "var(--teal)" }}>in one place.</span>
          </h1>

          <p style={{
            fontSize: 18, fontWeight: 400, color: "var(--app-text-3)", lineHeight: 1.65,
            maxWidth: 560, marginBottom: 36, margin: "0 auto 36px",
          }}>
            Mederti aggregates pharmaceutical shortage data from{" "}
            <span style={{ color: "var(--app-text-2)", fontWeight: 500 }}>regulatory bodies, manufacturers and clinical networks</span>{" "}
            across 9 countries — updated daily, AI-enriched, expert verified.
          </p>

          {/* SEARCH */}
          <div style={{ maxWidth: 480, margin: "0 auto" }}>
            <HeroSearch />
          </div>

          {/* EMAIL CAPTURE */}
          <div id="signup" style={{ marginTop: 48, paddingTop: 40, borderTop: "1px solid var(--app-border)", maxWidth: 480, margin: "48px auto 0" }}>
            <p style={{ fontSize: 13, fontWeight: 500, color: "var(--app-text-3)", marginBottom: 14, textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Get early access
            </p>
            <EmailCapture />
            <p style={{ fontSize: 12, color: "var(--app-text-4)", marginTop: 10 }}>
              Join <strong style={{ color: "var(--app-text-3)", fontWeight: 500 }}>pharmacists, procurement managers and regulators</strong> on the waitlist. Free to start.
            </p>
          </div>
        </div>

        {/* LIVE TICKER */}
        <div style={{
          position: "absolute", bottom: 0, left: 0, right: 0, zIndex: 1,
          borderTop: "1px solid var(--app-border)",
          background: "rgba(248,250,252,0.95)", backdropFilter: "blur(8px)",
          padding: "10px 48px",
          display: "flex", alignItems: "center", gap: 16, overflow: "hidden",
        }}>
          <div style={{
            fontSize: 10, fontWeight: 600, letterSpacing: "0.10em", textTransform: "uppercase",
            color: "var(--teal)", whiteSpace: "nowrap", flexShrink: 0,
            display: "flex", alignItems: "center", gap: 6,
          }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--teal)", animation: "blink 1.6s ease-in-out infinite", display: "inline-block" }} />
            Live shortages
          </div>
          <div style={{ display: "flex", gap: 0, animation: "ticker 40s linear infinite", whiteSpace: "nowrap" }}>
            {doubled.map((item, i) => (
              <div key={i} style={{
                display: "inline-flex", alignItems: "center", gap: 8,
                padding: "0 24px", fontSize: 12, color: "var(--app-text-3)",
                borderRight: "1px solid var(--app-border)",
              }}>
                <Dot color={item.color as "red" | "amber" | "green"} />
                {item.text}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* STATS BAND */}
      <div className="lp-stats-grid" style={{
        display: "grid", gridTemplateColumns: "repeat(4,1fr)",
        borderBottom: "1px solid var(--app-border)",
        background: "var(--app-bg)",
        maxWidth: 1200, margin: "0 auto",
      }}>
        {[
          { num: "12,400", label: "Shortage records", sub: "Aggregated from regulatory bodies worldwide" },
          { num: "9", label: "Countries covered", sub: "AU, US, UK, CA, DE, FR, IT, ES, EU" },
          { num: "50+", label: "Data sources", sub: "Regulatory, clinical and supply-side signals" },
          { num: "24h", label: "Refresh cycle", sub: "Every source checked and updated daily" },
        ].map((s, i) => (
          <div key={s.label} className="lp-stat-cell" style={{
            padding: "40px 40px",
            borderRight: i < 3 ? "1px solid var(--app-border)" : "none",
            textAlign: "center",
          }}>
            <div style={{
              fontSize: 44, fontWeight: 700, lineHeight: 1,
              color: "var(--app-text)", marginBottom: 10, letterSpacing: "-0.03em",
              fontFamily: "var(--font-inter), sans-serif",
            }}>
              {s.num}
            </div>
            <div style={{ fontSize: 14, fontWeight: 500, color: "var(--app-text-2)", marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontSize: 13, color: "var(--app-text-4)", lineHeight: 1.5 }}>{s.sub}</div>
          </div>
        ))}
      </div>

      {/* PRODUCT PREVIEW */}
      <div style={{ padding: "96px 48px", background: "#fff", borderBottom: "1px solid var(--app-border)" }}>
        <div style={{ textAlign: "center", marginBottom: 48 }}>
          <div style={{ fontSize: 11, fontWeight: 500, letterSpacing: "0.10em", textTransform: "uppercase", color: "var(--teal)", marginBottom: 14 }}>
            The platform
          </div>
          <h2 style={{
            fontSize: "clamp(28px,4vw,44px)", fontWeight: 700,
            lineHeight: 1.1, letterSpacing: "-0.025em",
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
      <section id="who" style={{ padding: "96px 48px", background: "var(--app-bg)", borderBottom: "1px solid var(--app-border)" }}>
        <div style={{ textAlign: "center", maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ fontSize: 11, fontWeight: 500, letterSpacing: "0.10em", textTransform: "uppercase", color: "var(--teal)", marginBottom: 16 }}>
          Who it&apos;s for
        </div>
        <h2 style={{ fontSize: "clamp(28px,4vw,44px)", fontWeight: 700, lineHeight: 1.1, letterSpacing: "-0.025em", color: "var(--app-text)", marginBottom: 16, maxWidth: 560, margin: "0 auto 16px" }}>
          Every part of the supply chain, served differently.
        </h2>
        <p style={{ fontSize: 16, color: "var(--app-text-3)", maxWidth: 500, lineHeight: 1.65, marginBottom: 56, margin: "0 auto 56px" }}>
          Three views of the same data — built for how each user actually works.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 1, background: "var(--app-border)", maxWidth: 1100, margin: "0 auto" }}>
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
            <div key={card.title} style={{ background: "#fff", padding: "36px 32px", textAlign: "left" }}>
              <div style={{ fontSize: 28, marginBottom: 16 }}>{card.icon}</div>
              <div style={{ fontSize: 16, fontWeight: 600, color: "var(--app-text)", marginBottom: 10, letterSpacing: "-0.01em" }}>{card.title}</div>
              <div style={{ fontSize: 14, color: "var(--app-text-3)", lineHeight: 1.7, marginBottom: 20 }}>{card.desc}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {card.features.map((f) => (
                  <div key={f} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--app-text-3)" }}>
                    <span style={{ color: "var(--teal)", fontSize: 11, flexShrink: 0 }}>→</span>
                    {f}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section id="how" style={{ padding: "96px 48px", background: "#fff", borderBottom: "1px solid var(--app-border)" }}>
        <div style={{ textAlign: "center", maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ fontSize: 11, fontWeight: 500, letterSpacing: "0.10em", textTransform: "uppercase", color: "var(--teal)", marginBottom: 16 }}>
          How it works
        </div>
        <h2 style={{ fontSize: "clamp(28px,4vw,44px)", fontWeight: 700, lineHeight: 1.1, letterSpacing: "-0.025em", color: "var(--app-text)", marginBottom: 16, maxWidth: 560, margin: "0 auto 16px" }}>
          From regulatory source to actionable intelligence.
        </h2>
        <p style={{ fontSize: 16, color: "var(--app-text-3)", maxWidth: 500, lineHeight: 1.65, marginBottom: 64, margin: "0 auto 64px" }}>
          Fully automated data pipeline with expert human curation on top.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 0, border: "1px solid var(--app-border)", borderRadius: 12, overflow: "hidden" }}>
          {[
            { num: "01", title: "Collect", desc: "Daily automated scraping of 50+ regulatory bodies — TGA, FDA, MHRA, EMA, Health Canada and more across 9 countries." },
            { num: "02", title: "Normalise", desc: "Raw data is cleaned, deduplicated, classified by severity and cross-referenced across sources to build confidence scores." },
            { num: "03", title: "Enrich", desc: "AI layer adds resolution forecasts, therapeutic alternatives, supply-chain origin analysis and early warning signals." },
            { num: "04", title: "Verify", desc: "20 years of pharmaceutical supply chain expertise applied as expert commentary and confidence overrides on key shortages." },
          ].map((step, i) => (
            <div key={step.num} style={{
              padding: "36px 32px",
              background: "#fff",
              borderRight: i < 3 ? "1px solid var(--app-border)" : "none",
            }}>
              <div style={{
                fontSize: 11, fontWeight: 600, letterSpacing: "0.08em",
                color: "var(--teal)", marginBottom: 20,
              }}>
                {step.num}
              </div>
              <div style={{ fontSize: 16, fontWeight: 600, color: "var(--app-text)", marginBottom: 12, letterSpacing: "-0.01em" }}>{step.title}</div>
              <div style={{ fontSize: 14, color: "var(--app-text-3)", lineHeight: 1.7 }}>{step.desc}</div>
            </div>
          ))}
        </div>
        </div>
      </section>

      {/* PRICING */}
      <section id="pricing" style={{ padding: "96px 48px", background: "var(--app-bg)", borderBottom: "1px solid var(--app-border)" }}>
        <div style={{ textAlign: "center", maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ fontSize: 11, fontWeight: 500, letterSpacing: "0.10em", textTransform: "uppercase", color: "var(--teal)", marginBottom: 16 }}>
          Pricing
        </div>
        <h2 style={{ fontSize: "clamp(28px,4vw,44px)", fontWeight: 700, lineHeight: 1.1, letterSpacing: "-0.025em", color: "var(--app-text)", marginBottom: 16, maxWidth: 560, margin: "0 auto 16px" }}>
          Start free. Scale when it matters.
        </h2>
        <p style={{ fontSize: 16, color: "var(--app-text-3)", maxWidth: 500, lineHeight: 1.65, marginBottom: 56, margin: "0 auto 56px" }}>
          Free for individual pharmacists. Institutional pricing for procurement teams and government.
        </p>

        <div className="lp-pricing-cards" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16, maxWidth: 960, margin: "0 auto" }}>
          {/* Free */}
          <div style={{ background: "#fff", border: "1px solid var(--app-border)", borderRadius: 12, padding: "36px 32px" }}>
            <div style={{ fontSize: 12, fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--app-text-4)", marginBottom: 20 }}>Free</div>
            <div style={{ fontSize: 44, fontWeight: 700, color: "var(--app-text)", lineHeight: 1, marginBottom: 4, letterSpacing: "-0.02em" }}>
              $0<span style={{ fontSize: 16, color: "var(--app-text-4)", fontWeight: 400 }}>/mo</span>
            </div>
            <div style={{ fontSize: 13, color: "var(--app-text-4)", marginBottom: 32, paddingBottom: 32, borderBottom: "1px solid var(--app-border)" }}>
              For individual pharmacists and clinicians
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 32 }}>
              {["Drug shortage search", "5 country availability view", "Basic alternative suggestions", "3 drug watchlist alerts", "Weekly shortage brief"].map((f) => (
                <div key={f} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14, color: "var(--app-text-2)" }}>
                  <span style={{ color: "var(--teal)", flexShrink: 0 }}>✓</span>
                  {f}
                </div>
              ))}
            </div>
            <button style={{
              width: "100%", padding: "12px", borderRadius: 8,
              fontSize: 14, fontWeight: 500, fontFamily: "var(--font-inter), sans-serif",
              cursor: "pointer", textAlign: "center",
              background: "#fff", border: "1px solid var(--app-border-2)", color: "var(--app-text-2)",
            }}>
              Get started free
            </button>
          </div>

          {/* Pro */}
          <div style={{
            background: "var(--app-text)", border: "1px solid var(--app-text)",
            borderRadius: 12, padding: "36px 32px", position: "relative",
          }}>
            <div style={{
              position: "absolute", top: -1, left: "50%", transform: "translateX(-50%)",
              fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase",
              background: "var(--teal)", color: "#fff", padding: "4px 14px", borderRadius: "0 0 8px 8px",
            }}>
              Most popular
            </div>
            <div style={{ fontSize: 12, fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: "rgba(255,255,255,0.4)", marginBottom: 20 }}>Pro</div>
            <div style={{ fontSize: 44, fontWeight: 700, color: "#fff", lineHeight: 1, marginBottom: 4, letterSpacing: "-0.02em" }}>
              $800<span style={{ fontSize: 16, color: "rgba(255,255,255,0.4)", fontWeight: 400 }}>/mo</span>
            </div>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", marginBottom: 32, paddingBottom: 32, borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
              Per institution · hospital, pharmacy group or distributor
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 32 }}>
              {[
                "Everything in Free", "Full analyst view with source data", "Unlimited watchlist alerts",
                "6-hourly data refresh", "AI shortage assistant", "Exportable PDF reports",
                "Expert curator commentary", "Up to 20 team seats",
              ].map((f) => (
                <div key={f} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14, color: "rgba(255,255,255,0.75)" }}>
                  <span style={{ color: "var(--teal)", flexShrink: 0 }}>✓</span>
                  {f}
                </div>
              ))}
            </div>
            <button style={{
              width: "100%", padding: "12px", borderRadius: 8,
              fontSize: 14, fontWeight: 600, fontFamily: "var(--font-inter), sans-serif",
              cursor: "pointer", textAlign: "center",
              background: "var(--teal)", border: "none", color: "#fff",
            }}>
              Start free trial
            </button>
          </div>

          {/* Enterprise */}
          <div style={{ background: "#fff", border: "1px solid var(--app-border)", borderRadius: 12, padding: "36px 32px" }}>
            <div style={{ fontSize: 12, fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--app-text-4)", marginBottom: 20 }}>Enterprise</div>
            <div style={{ fontSize: 36, fontWeight: 700, color: "var(--app-text)", lineHeight: 1, marginBottom: 4, letterSpacing: "-0.02em" }}>Custom</div>
            <div style={{ fontSize: 13, color: "var(--app-text-4)", marginBottom: 32, paddingBottom: 32, borderBottom: "1px solid var(--app-border)" }}>
              For regulators, health ministries and large distributors
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 32 }}>
              {[
                "Everything in Pro", "National supply dashboard", "AI early warning system",
                "Ministerial briefing generator", "Hourly refresh", "Dedicated data analyst",
                "API access", "SLA + compliance docs",
              ].map((f) => (
                <div key={f} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14, color: "var(--app-text-2)" }}>
                  <span style={{ color: "var(--teal)", flexShrink: 0 }}>✓</span>
                  {f}
                </div>
              ))}
            </div>
            <button style={{
              width: "100%", padding: "12px", borderRadius: 8,
              fontSize: 14, fontWeight: 500, fontFamily: "var(--font-inter), sans-serif",
              cursor: "pointer", textAlign: "center",
              background: "#fff", border: "1px solid var(--app-border-2)", color: "var(--app-text-2)",
            }}>
              Talk to us →
            </button>
          </div>
        </div>
        </div>
      </section>

      {/* WEEKLY BRIEF */}
      <section id="brief" style={{ padding: "96px 48px", background: "#fff", borderBottom: "1px solid var(--app-border)" }}>
        <div style={{
          maxWidth: 960, margin: "0 auto",
          display: "grid", gridTemplateColumns: "1fr 1fr", gap: 64, alignItems: "center",
        }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 500, letterSpacing: "0.10em", textTransform: "uppercase", color: "var(--teal)", marginBottom: 16 }}>
              Weekly brief
            </div>
            <h2 style={{ fontSize: "clamp(24px,3.5vw,38px)", fontWeight: 700, lineHeight: 1.15, letterSpacing: "-0.025em", color: "var(--app-text)", marginBottom: 16 }}>
              The shortage intelligence your inbox has been missing.
            </h2>
            <p style={{ fontSize: 15, color: "var(--app-text-3)", lineHeight: 1.7, marginBottom: 8 }}>
              Every Monday — new shortages declared, resolutions expected, supply signals to watch. Written by AI, verified by 20 years of industry expertise.
            </p>
            <p style={{ fontSize: 13, color: "var(--app-text-4)", marginBottom: 28 }}>
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
            background: "var(--app-bg)", border: "1px solid var(--app-border)",
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

      {/* FOOTER */}
      <footer className="lp-footer" style={{
        borderTop: "1px solid var(--app-border)",
        padding: "40px 48px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        background: "var(--app-bg)",
        maxWidth: 1200, margin: "0 auto",
      }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: "var(--app-text)", letterSpacing: "-0.02em" }}>
          Mederti<span style={{ color: "var(--teal)" }}>.</span>
        </div>
        <div style={{ fontSize: 13, color: "var(--app-text-4)" }}>
          © 2026 Mederti · Global pharmaceutical shortage intelligence
        </div>
        <div className="lp-footer-links" style={{ display: "flex", gap: 24 }}>
          <a href="/privacy" style={{ fontSize: 13, color: "var(--app-text-4)", textDecoration: "none" }}>Privacy</a>
          <a href="/terms" style={{ fontSize: 13, color: "var(--app-text-4)", textDecoration: "none" }}>Terms</a>
          <a href="mailto:hello@mederti.com" style={{ fontSize: 13, color: "var(--app-text-4)", textDecoration: "none" }}>Contact</a>
          <a href="/dashboard" style={{ fontSize: 13, color: "var(--app-text-4)", textDecoration: "none" }}>Dashboard</a>
        </div>
      </footer>

    </div>
  );
}
