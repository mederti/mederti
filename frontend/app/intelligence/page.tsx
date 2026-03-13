import Link from "next/link";
import type { Metadata } from "next";
import SiteNav from "@/app/components/landing-nav";
import SiteFooter from "@/app/components/site-footer";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  REPORTS, ARTICLES, DATA_RELEASES, MEDIA,
  CATEGORY_STYLE,
  type InsightCard,
} from "./data";

export const metadata: Metadata = {
  title: "Mederti Intelligence \u2014 Pharmaceutical Shortage Reports & Analysis",
  description:
    "Data-driven pharmaceutical shortage reports, supply chain analysis and market intelligence from the Mederti data team. Updated weekly.",
};

/* ── helpers ── */
function CategoryPill({ category }: { category: InsightCard["category"] }) {
  const s = CATEGORY_STYLE[category];
  return (
    <span style={{
      display: "inline-block", fontSize: 11, fontWeight: 600,
      padding: "3px 10px", borderRadius: 20,
      color: s.color, background: s.bg,
      letterSpacing: "0.02em",
    }}>
      {s.label}
    </span>
  );
}

function ProBadge() {
  return (
    <span
      title="Available on Pro plan"
      style={{
        display: "inline-flex", alignItems: "center",
        fontSize: 10, fontWeight: 700, padding: "2px 7px",
        borderRadius: 4, background: "var(--ind-bg)",
        color: "var(--indigo)", letterSpacing: "0.04em",
        marginLeft: 8,
      }}
    >
      PRO
    </span>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 600, letterSpacing: "0.12em",
      textTransform: "uppercase", color: "var(--app-text-4)",
      marginBottom: 24, paddingBottom: 12,
      borderBottom: "1px solid var(--app-border)",
    }}>
      {children}
    </div>
  );
}

export default async function IntelligencePage() {
  const supabase = getSupabaseAdmin();
  const [shortagesRes, sourcesRes] = await Promise.all([
    supabase.from("shortage_events").select("id", { count: "exact", head: true }).eq("status", "active"),
    supabase.from("data_sources").select("id", { count: "exact", head: true }),
  ]);
  const activeShortages = shortagesRes.count ?? 0;
  const sourceCount = sourcesRes.count ?? 0;
  const fmtShortages = activeShortages >= 1000
    ? (Math.floor(activeShortages / 100) * 100).toLocaleString("en-US") + "+"
    : String(activeShortages);

  const hero = ARTICLES[0]; // Amoxicillin article as hero
  const sideArticles = ARTICLES.slice(1);

  return (
    <div style={{ background: "#fff", minHeight: "100vh", fontFamily: "var(--font-inter, system-ui, sans-serif)" }}>
      <SiteNav />

      {/* ─── MASTHEAD BAR ─── */}
      <div style={{
        borderBottom: "1px solid var(--app-border)",
        padding: "16px 24px",
        background: "#fff",
      }}>
        <div style={{ maxWidth: 1080, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{
              fontSize: 15, fontWeight: 700, letterSpacing: "-0.01em",
              color: "var(--app-text)",
            }}>
              Mederti Intelligence
            </span>
            <span style={{ fontSize: 12, color: "var(--app-text-4)" }}>
              Pharmaceutical supply chain intelligence
            </span>
          </div>
          <div style={{
            display: "flex", alignItems: "center", gap: 14,
            fontSize: 12, color: "var(--app-text-4)",
          }}>
            <span>
              <span style={{ color: "var(--teal)", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{fmtShortages}</span> active shortages
            </span>
            <span style={{ color: "var(--app-border)" }}>|</span>
            <span>
              <span style={{ color: "var(--teal)", fontWeight: 600 }}>{sourceCount}+</span> sources
            </span>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1080, margin: "0 auto", padding: "0 24px" }}>

        {/* ─── HERO: featured article + sidebar articles ─── */}
        <section className="intel-hero" style={{
          display: "grid", gridTemplateColumns: "1fr 380px",
          gap: 32, padding: "40px 0", borderBottom: "1px solid var(--app-border)",
        }}>
          {/* Main hero */}
          <Link href={`/intelligence/${hero.slug}`} style={{ textDecoration: "none", display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Image placeholder */}
            <div style={{
              width: "100%", aspectRatio: "16/9", background: "#0f172a",
              borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <span style={{
                fontSize: 11, fontWeight: 600, letterSpacing: "0.10em",
                textTransform: "uppercase", color: "rgba(255,255,255,0.3)",
              }}>
                Featured
              </span>
            </div>
            <div>
              <CategoryPill category={hero.category} />
            </div>
            <h1 style={{
              fontSize: "clamp(24px,3vw,34px)", fontWeight: 750,
              lineHeight: 1.15, letterSpacing: "-0.025em",
              color: "var(--app-text)", margin: 0,
            }}>
              {hero.title}
            </h1>
            <p style={{ fontSize: 15, color: "var(--app-text-3)", lineHeight: 1.6, margin: 0 }}>
              {hero.description}
            </p>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--app-text-4)" }}>
              {hero.author && <span style={{ fontWeight: 500 }}>{hero.author}</span>}
              {hero.author && <span>&middot;</span>}
              <span>{hero.date}</span>
              {hero.readTime && <><span>&middot;</span><span>{hero.readTime}</span></>}
            </div>
          </Link>

          {/* Side articles stack */}
          <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
            {sideArticles.map((a, i) => (
              <div key={a.slug} style={{
                padding: "20px 0",
                borderBottom: i < sideArticles.length - 1 ? "1px solid var(--app-border)" : "none",
              }}>
                <CategoryPill category={a.category} />
                <div style={{
                  fontSize: 16, fontWeight: 650, color: "var(--app-text)",
                  lineHeight: 1.3, letterSpacing: "-0.01em",
                  margin: "10px 0 8px",
                }}>
                  {a.title}
                </div>
                <p style={{ fontSize: 13, color: "var(--app-text-3)", lineHeight: 1.55, margin: "0 0 8px" }}>
                  {a.description}
                </p>
                <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--app-text-4)" }}>
                  {a.author && <span style={{ fontWeight: 500 }}>{a.author}</span>}
                  {a.author && <span>&middot;</span>}
                  <span>{a.date}</span>
                </div>
              </div>
            ))}

            {/* Data signal teaser in sidebar */}
            <div style={{
              marginTop: 20, padding: "16px 20px",
              background: "var(--app-bg)", borderRadius: 8,
              border: "1px solid var(--app-border)",
            }}>
              <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.10em", textTransform: "uppercase", color: "var(--low)", marginBottom: 8 }}>
                Latest signal
              </div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--app-text)", lineHeight: 1.35 }}>
                {DATA_RELEASES[0].icon} {DATA_RELEASES[0].title}
              </div>
              <div style={{ fontSize: 12, color: "var(--app-text-4)", marginTop: 4 }}>
                {DATA_RELEASES[0].date}
              </div>
            </div>
          </div>
        </section>

        {/* ─── SHORTAGE REPORTS ─── */}
        <section id="reports" style={{ padding: "48px 0 0", scrollMarginTop: 80 }}>
          <SectionLabel>Shortage Reports</SectionLabel>
          <div className="intel-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20 }}>
            {REPORTS.map((r) => (
              <div key={r.slug} style={{
                background: "#fff", border: "1px solid var(--app-border)",
                borderRadius: 10, padding: "24px 22px",
                display: "flex", flexDirection: "column", gap: 10,
              }}>
                <CategoryPill category={r.category} />
                <div style={{ fontSize: 15, fontWeight: 650, color: "var(--app-text)", lineHeight: 1.3, letterSpacing: "-0.01em" }}>
                  {r.title}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12, color: "var(--app-text-4)" }}>
                  <span>{r.date}</span>
                  {r.readTime && <><span>&middot;</span><span>{r.readTime}</span></>}
                </div>
                <p style={{ fontSize: 13, color: "var(--app-text-3)", lineHeight: 1.6, margin: 0, flex: 1 }}>
                  {r.description}
                </p>
                <div>
                  <a href="#" style={{
                    display: "inline-flex", alignItems: "center",
                    padding: "7px 16px", borderRadius: 6,
                    fontSize: 12, fontWeight: 600,
                    color: "var(--app-text-2)", textDecoration: "none",
                    border: "1px solid var(--app-border)",
                    background: "#fff",
                  }}>
                    Download PDF
                    {r.isPro && <ProBadge />}
                  </a>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ─── DATA & SIGNALS ─── */}
        <section id="signals" style={{ padding: "48px 0 0", scrollMarginTop: 80 }}>
          <SectionLabel>Data and Signals</SectionLabel>
          <div className="intel-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20 }}>
            {DATA_RELEASES.map((d) => (
              <div key={d.slug} style={{
                background: "#fff", border: "1px solid var(--app-border)",
                borderRadius: 10, padding: "22px",
                display: "flex", flexDirection: "column", gap: 8,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  {d.icon && <span style={{ fontSize: 20 }}>{d.icon}</span>}
                  <CategoryPill category={d.category} />
                </div>
                <div style={{ fontSize: 14, fontWeight: 620, color: "var(--app-text)", lineHeight: 1.35 }}>
                  {d.title}
                </div>
                <div style={{ fontSize: 12, color: "var(--app-text-4)" }}>{d.date}</div>
                <p style={{ fontSize: 13, color: "var(--app-text-3)", lineHeight: 1.55, margin: 0 }}>
                  {d.description}
                </p>
                <div>
                  <Link href="/dashboard" style={{ fontSize: 12, fontWeight: 600, color: "var(--low)", textDecoration: "none" }}>
                    View data &rarr;
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ─── PODCASTS & VIDEO ─── */}
        <section id="podcasts" style={{ padding: "48px 0 64px", scrollMarginTop: 80 }}>
          <SectionLabel>Podcasts and Video</SectionLabel>
          <div className="intel-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20 }}>
            {MEDIA.map((m) => (
              <div key={m.slug} style={{
                background: "#fff", border: "1px solid var(--app-border)",
                borderRadius: 10, overflow: "hidden",
                display: "flex", flexDirection: "column",
              }}>
                <div style={{
                  height: 140, background: "#0f172a",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  borderBottom: "1px solid var(--app-border)",
                }}>
                  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" style={{ opacity: 0.35 }}>
                    <polygon points="5,3 19,12 5,21" fill="#fff" />
                  </svg>
                </div>
                <div style={{ padding: "18px 22px", display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <CategoryPill category={m.category} />
                    {m.duration && (
                      <span style={{
                        fontSize: 11, fontWeight: 600, padding: "2px 8px",
                        borderRadius: 20, color: "var(--med)", background: "var(--med-bg)",
                      }}>
                        {m.duration}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 620, color: "var(--app-text)", lineHeight: 1.35 }}>
                    {m.title}
                  </div>
                  <p style={{ fontSize: 13, color: "var(--app-text-3)", lineHeight: 1.55, margin: 0, flex: 1 }}>
                    {m.description}
                  </p>
                  <div>
                    <a href="#" style={{ fontSize: 12, fontWeight: 600, color: "var(--med)", textDecoration: "none" }}>
                      {m.title.toLowerCase().includes("video") ? "Watch" : "Listen"} &rarr;
                    </a>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <SiteFooter />

      <style>{`
        @media (max-width: 860px) {
          .intel-hero { grid-template-columns: 1fr !important; }
        }
        @media (max-width: 768px) {
          .intel-grid { grid-template-columns: 1fr 1fr !important; }
        }
        @media (max-width: 540px) {
          .intel-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}
