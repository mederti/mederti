"use client";

import Link from "next/link";
import SiteNav from "./landing-nav";
import SiteFooter from "./site-footer";
import { EmailCapture } from "./email-capture";

/* ── Types ── */

export interface FeatureBlock {
  icon: string;
  title: string;
  desc: string;
}

export interface PersonaContent {
  /* Hero */
  heroHeadline: string;
  heroSub: string;
  heroCta: string;
  heroCtaHref: string;

  /* Problem */
  problemHeadline: string;
  problemText: string;

  /* Features */
  features: FeatureBlock[];

  /* Preview — which Mederti view to mock */
  previewTitle: string;
  previewUrl: string;
  previewRows: { label: string; badge: string; badgeColor: string; badgeBg: string }[];

  /* Testimonial */
  quote: string;
  quoteName: string;
  quoteRole: string;

  /* Final CTA */
  ctaHeadline: string;
  ctaButton: string;
  ctaHref: string;
}

/* ── Shared page shell ── */

export default function PersonaPage({ content }: { content: PersonaContent }) {
  const c = content;

  return (
    <div style={{ background: "var(--app-bg)", minHeight: "100vh" }}>
      <SiteNav />

      {/* ─── HERO ─── */}
      <section style={{
        padding: "96px 24px 80px",
        textAlign: "center",
        background: "#fff",
      }}>
        <div style={{ maxWidth: 720, margin: "0 auto" }}>
          <h1 style={{
            fontSize: "clamp(32px,5vw,52px)",
            fontWeight: 750,
            lineHeight: 1.08,
            letterSpacing: "-0.035em",
            color: "var(--app-text)",
            margin: "0 0 20px",
          }}>
            {c.heroHeadline}
          </h1>
          <p style={{
            fontSize: "clamp(16px,2vw,19px)",
            color: "var(--app-text-3)",
            lineHeight: 1.6,
            maxWidth: 560,
            margin: "0 auto 36px",
          }}>
            {c.heroSub}
          </p>
          <Link href={c.heroCtaHref} style={{
            display: "inline-flex", alignItems: "center",
            padding: "14px 36px", borderRadius: 10,
            fontSize: 15, fontWeight: 600,
            color: "#fff", textDecoration: "none",
            background: "var(--teal, #0d9488)",
            transition: "opacity 0.15s",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = "0.88"; }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = "1"; }}
          >
            {c.heroCta}
          </Link>
        </div>
      </section>

      {/* ─── PROBLEM STATEMENT (dark) ─── */}
      <section style={{
        background: "var(--app-text, #0f172a)",
        padding: "72px 24px",
      }}>
        <div style={{ maxWidth: 680, margin: "0 auto", textAlign: "center" }}>
          <div style={{
            fontSize: 11, fontWeight: 500, letterSpacing: "0.10em",
            textTransform: "uppercase", color: "var(--teal)", marginBottom: 14,
          }}>
            The problem
          </div>
          <h2 style={{
            fontSize: "clamp(22px,3.5vw,32px)", fontWeight: 700,
            lineHeight: 1.2, letterSpacing: "-0.025em",
            color: "#fff", marginBottom: 20,
          }}>
            {c.problemHeadline}
          </h2>
          <p style={{
            fontSize: 15, color: "rgba(255,255,255,0.6)",
            lineHeight: 1.75, maxWidth: 580, margin: "0 auto",
          }}>
            {c.problemText}
          </p>
        </div>
      </section>

      {/* ─── HOW MEDERTI HELPS — feature grid ─── */}
      <section style={{ padding: "80px 24px" }}>
        <div style={{ maxWidth: 1000, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: 48 }}>
            <div style={{
              fontSize: 11, fontWeight: 500, letterSpacing: "0.10em",
              textTransform: "uppercase", color: "var(--teal)", marginBottom: 10,
            }}>
              How Mederti helps
            </div>
            <h2 style={{
              fontSize: "clamp(24px,3.5vw,36px)", fontWeight: 700,
              lineHeight: 1.15, letterSpacing: "-0.025em",
              color: "var(--app-text)", margin: "0 auto",
            }}>
              Built for how you actually work.
            </h2>
          </div>

          <div className="persona-features-grid" style={{
            display: "grid",
            gridTemplateColumns: `repeat(${c.features.length > 3 ? 4 : 3}, 1fr)`,
            gap: 16,
          }}>
            {c.features.map((f) => (
              <div key={f.title} style={{
                background: "#fff",
                border: "1px solid var(--app-border)",
                borderRadius: 12,
                padding: "28px 24px",
              }}>
                <div style={{ fontSize: 28, marginBottom: 14 }}>{f.icon}</div>
                <div style={{
                  fontSize: 15, fontWeight: 600, color: "var(--app-text)",
                  marginBottom: 10, letterSpacing: "-0.01em",
                }}>
                  {f.title}
                </div>
                <div style={{
                  fontSize: 13, color: "var(--app-text-3)", lineHeight: 1.65,
                }}>
                  {f.desc}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── PLATFORM PREVIEW ─── */}
      <section style={{ padding: "0 24px 80px" }}>
        <div style={{ maxWidth: 1000, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: 36 }}>
            <div style={{
              fontSize: 11, fontWeight: 500, letterSpacing: "0.10em",
              textTransform: "uppercase", color: "var(--teal)", marginBottom: 10,
            }}>
              The platform
            </div>
            <h2 style={{
              fontSize: "clamp(24px,3.5vw,36px)", fontWeight: 700,
              lineHeight: 1.15, letterSpacing: "-0.025em",
              color: "var(--app-text)", margin: "0 auto",
            }}>
              {c.previewTitle}
            </h2>
          </div>

          <div style={{
            border: "1px solid var(--app-border)", borderRadius: 14, overflow: "hidden",
            background: "#fff",
            boxShadow: "0 8px 48px rgba(15,23,42,0.08), 0 2px 8px rgba(15,23,42,0.04)",
            maxWidth: 900, margin: "0 auto",
          }}>
            {/* Browser chrome */}
            <div style={{
              background: "var(--app-bg)", padding: "12px 18px",
              display: "flex", alignItems: "center", gap: 10,
              borderBottom: "1px solid var(--app-border)",
            }}>
              {["#ef4444", "#f97316", "#22c55e"].map((col) => (
                <span key={col} style={{
                  width: 10, height: 10, borderRadius: "50%",
                  background: col, display: "inline-block", opacity: 0.7,
                }} />
              ))}
              <span style={{
                flex: 1, background: "#fff", border: "1px solid var(--app-border)",
                borderRadius: 5, padding: "4px 12px", fontSize: 12,
                color: "var(--app-text-4)",
                fontFamily: "var(--font-dm-mono), monospace", maxWidth: 320,
              }}>
                {c.previewUrl}
              </span>
            </div>

            {/* Mock content */}
            <div style={{ padding: "24px 28px" }}>
              {c.previewRows.map((row, i) => (
                <div key={i} style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "11px 0",
                  borderBottom: i < c.previewRows.length - 1 ? "1px solid var(--app-border)" : "none",
                }}>
                  <span style={{ fontSize: 13, color: "var(--app-text)" }}>{row.label}</span>
                  <span style={{
                    fontSize: 10, fontWeight: 600, padding: "3px 8px",
                    borderRadius: 4, background: row.badgeBg, color: row.badgeColor,
                  }}>
                    {row.badge}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ─── TESTIMONIAL ─── */}
      <section style={{
        padding: "72px 24px",
        background: "#fff",
        borderTop: "1px solid var(--app-border)",
        borderBottom: "1px solid var(--app-border)",
      }}>
        <div style={{ maxWidth: 640, margin: "0 auto", textAlign: "center" }}>
          <div style={{
            fontSize: 32, color: "var(--teal)", marginBottom: 20,
            fontFamily: "Georgia, serif", lineHeight: 1,
          }}>
            {"\u201C"}
          </div>
          <blockquote style={{
            fontSize: "clamp(16px,2vw,19px)",
            color: "var(--app-text-2)",
            lineHeight: 1.7,
            fontStyle: "italic",
            margin: "0 0 24px",
          }}>
            {c.quote}
          </blockquote>
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--app-text)" }}>
            {c.quoteName}
          </div>
          <div style={{ fontSize: 13, color: "var(--app-text-4)", marginTop: 4 }}>
            {c.quoteRole}
          </div>
        </div>
      </section>

      {/* ─── FINAL CTA ─── */}
      <section style={{ padding: "80px 24px", textAlign: "center" }}>
        <div style={{ maxWidth: 560, margin: "0 auto" }}>
          <h2 style={{
            fontSize: "clamp(22px,3.5vw,32px)", fontWeight: 700,
            lineHeight: 1.2, letterSpacing: "-0.025em",
            color: "var(--app-text)", marginBottom: 28,
          }}>
            {c.ctaHeadline}
          </h2>
          <Link href={c.ctaHref} style={{
            display: "inline-flex", alignItems: "center",
            padding: "14px 40px", borderRadius: 10,
            fontSize: 15, fontWeight: 600,
            color: "#fff", textDecoration: "none",
            background: "var(--teal, #0d9488)",
            transition: "opacity 0.15s",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = "0.88"; }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = "1"; }}
          >
            {c.ctaButton}
          </Link>
        </div>
      </section>

      <SiteFooter />

      <style>{`
        @media (max-width: 768px) {
          .persona-features-grid {
            grid-template-columns: 1fr 1fr !important;
          }
        }
        @media (max-width: 480px) {
          .persona-features-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </div>
  );
}
