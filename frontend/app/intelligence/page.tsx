import Link from "next/link";
import type { Metadata } from "next";
import SiteNav from "@/app/components/landing-nav";
import SiteFooter from "@/app/components/site-footer";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import MarketSidebar from "./MarketSidebar";
import NewsletterForm from "./NewsletterForm";
import IntelligenceBriefing from "./IntelligenceBriefing";
import {
  REPORTS, ARTICLES, DATA_RELEASES, MEDIA,
  CATEGORY_STYLE,
  type InsightCard,
} from "./data";

export const metadata: Metadata = {
  title: "Mederti Intelligence — The industry hub for pharmaceutical supply intelligence",
  description:
    "Data-driven pharmaceutical shortage reports, supply chain analysis and market intelligence from the Mederti data team. Updated weekly.",
  openGraph: {
    title: "Mederti Intelligence — The industry hub for pharmaceutical supply intelligence",
    description:
      "Data-driven pharmaceutical shortage reports, supply chain analysis and market intelligence from the Mederti data team. Updated weekly.",
  },
};

/* ── helpers ── */
function CategoryTag({ category }: { category: InsightCard["category"] }) {
  const s = CATEGORY_STYLE[category];
  return (
    <span style={{
      fontSize: 11, fontWeight: 600, letterSpacing: "0.08em",
      textTransform: "uppercase", color: s.color,
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

function SectionDivider({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 600, letterSpacing: "0.12em",
      textTransform: "uppercase", color: "var(--app-text-4)",
      paddingBottom: 16, marginBottom: 28,
      borderBottom: "2px solid var(--app-text)",
    }}>
      {children}
    </div>
  );
}

/* Convert a DB row to InsightCard format */
function dbToCard(row: {
  slug: string;
  title: string;
  description: string;
  category: string;
  author: string;
  read_time: string | null;
  published_at: string | null;
  drug_name: string | null;
}): InsightCard {
  const d = row.published_at ? new Date(row.published_at) : new Date();
  return {
    slug: row.slug,
    category: (row.category as InsightCard["category"]) ?? "article",
    title: row.title,
    date: d.toLocaleDateString("en-AU", { month: "long", year: "numeric" }),
    description: row.description,
    author: row.author,
    readTime: row.read_time ?? undefined,
  };
}

export default async function IntelligencePage() {
  const supabase = getSupabaseAdmin();
  const [shortagesRes, sourcesRes, dbArticlesRes] = await Promise.all([
    supabase.from("shortage_events").select("id", { count: "exact", head: true }).eq("status", "active"),
    supabase.from("data_sources").select("id", { count: "exact", head: true }),
    supabase
      .from("intelligence_articles")
      .select("slug, title, description, category, author, read_time, published_at, drug_name")
      .eq("status", "published")
      .order("published_at", { ascending: false })
      .limit(10),
  ]);
  const activeShortages = shortagesRes.count ?? 0;
  const sourceCount = sourcesRes.count ?? 0;
  const fmtShortages = activeShortages >= 1000
    ? (Math.floor(activeShortages / 100) * 100).toLocaleString("en-US") + "+"
    : String(activeShortages);

  /* Map DB articles to InsightCard format */
  const dbCards = (dbArticlesRes.data ?? []).map(dbToCard);
  const dbArticleCards = dbCards.filter((c) => c.category === "article");

  /* Use DB articles for hero section if available, fall back to placeholders */
  const heroSource = dbArticleCards.length > 0 ? dbArticleCards : ARTICLES;
  const hero = heroSource[0];
  const sideArticles = heroSource.slice(1, 4);

  return (
    <div style={{ background: "#fff", minHeight: "100vh" }}>
      <SiteNav />

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 32px" }}>

        {/* ─── TWO-COLUMN: main (70%) + market sidebar (30%) ─── */}
        <div className="intel-two-col" style={{
          display: "flex", gap: 48, paddingTop: 0,
        }}>
          {/* Main content column */}
          <div className="intel-main-col" style={{ flex: "1 1 0%", minWidth: 0 }}>

        {/* ─── DAILY AI BRIEFING (The Pharma Brief) ─── */}
        <div style={{ paddingTop: 36 }}>
          <IntelligenceBriefing />
        </div>

        {/* ─── REGULATORY CALENDAR LINK ─── */}
        <div style={{ marginBottom: 32, padding: 18, background: "#fff", border: "1px solid var(--app-border)", borderRadius: 12, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--teal)", marginBottom: 4 }}>
              Regulatory calendar
            </div>
            <div style={{ fontSize: 14, color: "var(--app-text-3)" }}>
              Upcoming FDA AdComm, EMA CHMP opinions, MHRA decisions, Phase III completions — all in one place.
            </div>
          </div>
          <Link href="/intelligence/calendar" style={{ padding: "10px 18px", background: "var(--app-text)", color: "white", borderRadius: 6, fontSize: 13, fontWeight: 600, textDecoration: "none" }}>
            Open calendar →
          </Link>
        </div>

        {/* ─── HERO: lead article + sidebar stack ─── */}
        <section className="intel-hero" style={{
          display: "grid", gridTemplateColumns: "1fr 340px",
          gap: 48, padding: "48px 0 44px",
          borderBottom: "1px solid #e5e7eb",
        }}>
          {/* Main hero */}
          <Link href={`/intelligence/${hero.slug}`} style={{ textDecoration: "none", display: "flex", flexDirection: "column", gap: 0 }}>
            {/* Image placeholder */}
            <div style={{
              width: "100%", aspectRatio: "16/9", background: "#f1f5f9",
              borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center",
              marginBottom: 24,
            }}>
              <span style={{
                fontSize: 12, fontWeight: 500, letterSpacing: "0.06em",
                textTransform: "uppercase", color: "#94a3b8",
              }}>
                Featured
              </span>
            </div>
            <CategoryTag category={hero.category} />
            <h1 style={{
              fontSize: "clamp(26px, 3vw, 36px)", fontWeight: 700,
              lineHeight: 1.18, letterSpacing: "-0.02em",
              color: "#0f172a", margin: "12px 0 16px",
            }}>
              {hero.title}
            </h1>
            <p style={{ fontSize: 15, color: "#64748b", lineHeight: 1.65, margin: "0 0 16px" }}>
              {hero.description}
            </p>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#94a3b8" }}>
              {hero.author && <span style={{ fontWeight: 500, color: "#64748b" }}>{hero.author}</span>}
              {hero.author && <span>&middot;</span>}
              <span>{hero.date}</span>
              {hero.readTime && <><span>&middot;</span><span>{hero.readTime}</span></>}
            </div>
          </Link>

          {/* Side articles stack */}
          <div style={{ display: "flex", flexDirection: "column" }}>
            {sideArticles.map((a, i) => (
              <div key={a.slug} style={{
                padding: "24px 0",
                borderBottom: i < sideArticles.length - 1 ? "1px solid #e5e7eb" : "none",
              }}>
                <CategoryTag category={a.category} />
                <div style={{
                  fontSize: 18, fontWeight: 650, color: "#0f172a",
                  lineHeight: 1.3, letterSpacing: "-0.01em",
                  margin: "8px 0 10px",
                }}>
                  {a.title}
                </div>
                <p style={{ fontSize: 13, color: "#64748b", lineHeight: 1.55, margin: "0 0 8px" }}>
                  {a.description}
                </p>
                <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#94a3b8" }}>
                  {a.author && <span style={{ fontWeight: 500, color: "#64748b" }}>{a.author}</span>}
                  {a.author && <span>&middot;</span>}
                  <span>{a.date}</span>
                </div>
              </div>
            ))}

            {/* Data signal teaser */}
            <div style={{
              marginTop: 24, padding: "18px 20px",
              background: "#f8fafc", borderRadius: 6,
              borderLeft: "3px solid var(--low)",
            }}>
              <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.10em", textTransform: "uppercase", color: "var(--low)", marginBottom: 6 }}>
                Latest signal
              </div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#0f172a", lineHeight: 1.35 }}>
                {DATA_RELEASES[0].icon} {DATA_RELEASES[0].title}
              </div>
              <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>
                {DATA_RELEASES[0].date}
              </div>
            </div>
          </div>
        </section>

        {/* ─── SHORTAGE REPORTS ─── */}
        <section id="reports" style={{ padding: "48px 0 0", scrollMarginTop: 80 }}>
          <SectionDivider>Shortage Reports</SectionDivider>
          <div className="intel-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 32 }}>
            {REPORTS.map((r) => (
              <div key={r.slug} style={{
                display: "flex", flexDirection: "column", gap: 10,
              }}>
                <CategoryTag category={r.category} />
                <div style={{
                  fontSize: 17, fontWeight: 650, color: "#0f172a",
                  lineHeight: 1.3, letterSpacing: "-0.01em",
                }}>
                  {r.title}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12, color: "#94a3b8" }}>
                  <span>{r.date}</span>
                  {r.readTime && <><span>&middot;</span><span>{r.readTime}</span></>}
                </div>
                <p style={{ fontSize: 14, color: "#64748b", lineHeight: 1.6, margin: 0, flex: 1 }}>
                  {r.description}
                </p>
                <div>
                  <Link href={`/intelligence/${r.slug}`} style={{
                    display: "inline-flex", alignItems: "center",
                    padding: "8px 18px", borderRadius: 6,
                    fontSize: 12, fontWeight: 600,
                    color: "#0f172a", textDecoration: "none",
                    border: "1px solid #d1d5db",
                    background: "#fff",
                  }}>
                    Read report
                    {r.isPro && <ProBadge />}
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ─── DATA & SIGNALS ─── */}
        <section id="signals" style={{ padding: "48px 0 0", scrollMarginTop: 80 }}>
          <SectionDivider>Data &amp; Signals</SectionDivider>
          <div className="intel-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 32 }}>
            {DATA_RELEASES.map((d) => (
              <div key={d.slug} style={{
                display: "flex", flexDirection: "column", gap: 8,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  {d.icon && <span style={{ fontSize: 20 }}>{d.icon}</span>}
                  <CategoryTag category={d.category} />
                </div>
                <div style={{
                  fontSize: 16, fontWeight: 650, color: "#0f172a", lineHeight: 1.35,
                }}>
                  {d.title}
                </div>
                <div style={{ fontSize: 12, color: "#94a3b8" }}>{d.date}</div>
                <p style={{ fontSize: 14, color: "#64748b", lineHeight: 1.6, margin: 0 }}>
                  {d.description}
                </p>
                <div>
                  <Link href="/dashboard" style={{ fontSize: 12, fontWeight: 600, color: "var(--teal)", textDecoration: "none" }}>
                    View data &rarr;
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ─── PODCASTS & VIDEO ─── */}
        <section id="podcasts" style={{ padding: "48px 0 64px", scrollMarginTop: 80 }}>
          <SectionDivider>Podcasts &amp; Video</SectionDivider>
          <div className="intel-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 32 }}>
            {MEDIA.map((m) => (
              <div key={m.slug} style={{
                display: "flex", flexDirection: "column",
                overflow: "hidden",
              }}>
                <div style={{
                  height: 160, background: "#0f172a",
                  borderRadius: 6,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  marginBottom: 16,
                }}>
                  <svg width="36" height="36" viewBox="0 0 24 24" fill="none" style={{ opacity: 0.3 }}>
                    <polygon points="5,3 19,12 5,21" fill="#fff" />
                  </svg>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                  <CategoryTag category={m.category} />
                  {m.duration && (
                    <span style={{
                      fontSize: 11, fontWeight: 500,
                      color: "#94a3b8",
                    }}>
                      {m.duration}
                    </span>
                  )}
                </div>
                <div style={{
                  fontSize: 16, fontWeight: 650, color: "#0f172a", lineHeight: 1.35,
                  marginBottom: 8,
                }}>
                  {m.title}
                </div>
                <p style={{ fontSize: 14, color: "#64748b", lineHeight: 1.6, margin: "0 0 12px", flex: 1 }}>
                  {m.description}
                </p>
                <div>
                  <span style={{ fontSize: 11, fontWeight: 500, color: "#94a3b8", fontStyle: "italic" }}>
                    Coming soon
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>

          </div>{/* end .intel-main-col */}

          {/* Market data sidebar (30%) */}
          <div className="intel-sidebar-col" style={{ width: 300, flexShrink: 0 }}>
            <div style={{ paddingTop: 48 }}>
              <MarketSidebar />
            </div>
          </div>

        </div>{/* end .intel-two-col */}
      </div>

      {/* ─── NEWSLETTER FOOTER ─── */}
      <NewsletterForm />

      <SiteFooter />

      <style>{`
        @media (max-width: 1024px) {
          .intel-two-col { flex-direction: column !important; }
          .intel-sidebar-col {
            width: 100% !important;
            border-top: 1px solid #e5e7eb;
            padding-top: 32px !important;
          }
          .intel-sidebar-col > div { padding-top: 0 !important; }
          .market-sidebar { position: static !important; }
        }
        @media (max-width: 860px) {
          .intel-hero { grid-template-columns: 1fr !important; }
        }
        @media (max-width: 768px) {
          .intel-grid { grid-template-columns: 1fr 1fr !important; }
          .intel-newsletter-form { flex-direction: column !important; align-items: center !important; }
          .intel-newsletter-form input { width: 100% !important; max-width: 320px !important; }
        }
        @media (max-width: 540px) {
          .intel-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}
