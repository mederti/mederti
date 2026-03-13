import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import SiteNav from "@/app/components/landing-nav";
import SiteFooter from "@/app/components/site-footer";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  AMOXICILLIN_ARTICLE,
  RELATED_ARTICLES,
  ARTICLES,
  CATEGORY_STYLE,
  type Category,
  type InsightCard,
} from "../data";

/* ── article lookup (placeholder articles) ── */
const ALL_ARTICLES: Record<string, typeof AMOXICILLIN_ARTICLE> = {
  [AMOXICILLIN_ARTICLE.slug]: AMOXICILLIN_ARTICLE,
};

interface DBArticle {
  id: string;
  slug: string;
  title: string;
  description: string;
  category: string;
  content_type: string;
  body_json: { heading?: string; body: string }[];
  author: string;
  read_time: string | null;
  drug_id: string | null;
  drug_name: string | null;
  meta_description: string | null;
  pull_quote: string | null;
  published_at: string | null;
}

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;

  /* Check DB first */
  const supabase = getSupabaseAdmin();
  const { data: dbRow } = await supabase
    .from("intelligence_articles")
    .select("title, meta_description")
    .eq("slug", slug)
    .eq("status", "published")
    .single();

  if (dbRow) {
    return {
      title: `${dbRow.title} — Mederti Intelligence`,
      description: dbRow.meta_description ?? undefined,
    };
  }

  const article = ALL_ARTICLES[slug];
  if (!article) return { title: "Not Found" };
  return {
    title: `${article.title} — Mederti Intelligence`,
    description: article.metaDescription,
  };
}

export default async function IntelligenceArticlePage({ params }: Props) {
  const { slug } = await params;
  const supabase = getSupabaseAdmin();

  /* ── Try DB first, then placeholder ── */
  const { data: dbArticle } = await supabase
    .from("intelligence_articles")
    .select("id, slug, title, description, category, content_type, body_json, author, read_time, drug_id, drug_name, meta_description, pull_quote, published_at")
    .eq("slug", slug)
    .eq("status", "published")
    .single();

  const placeholderArticle = ALL_ARTICLES[slug] ?? null;
  if (!dbArticle && !placeholderArticle) notFound();

  /* ── Normalize into rendering vars ── */
  const isDB = !!dbArticle;
  const articleTitle = isDB ? dbArticle.title : placeholderArticle!.title;
  const articleAuthor = isDB ? dbArticle.author : placeholderArticle!.author;
  const articleDate = isDB
    ? (dbArticle.published_at ? new Date(dbArticle.published_at).toLocaleDateString("en-AU", { month: "long", year: "numeric" }) : "")
    : placeholderArticle!.date;
  const articleReadTime = isDB ? (dbArticle.read_time ?? "") : placeholderArticle!.readTime;
  const articleCategory = (isDB ? dbArticle.category : placeholderArticle!.category) as Category;
  const sections: { heading?: string; body: string }[] = isDB ? (dbArticle.body_json ?? []) : placeholderArticle!.sections;
  const pullQuote = isDB ? dbArticle.pull_quote : placeholderArticle!.pullQuote;
  const drugId = isDB ? dbArticle.drug_id : null;
  const drugName = isDB ? dbArticle.drug_name : "Amoxicillin";

  /* ── Live data callout — generic drug shortage stats ── */
  let shortageCount = 0;
  let countries: string[] = [];
  let critCount = 0;
  let highCount = 0;
  let drugRowId: string | null = null;

  if (drugId) {
    /* DB article with drug_id — look up shortages for that specific drug */
    const { data: drugRow } = await supabase
      .from("drugs")
      .select("id, generic_name")
      .eq("id", drugId)
      .single();

    if (drugRow) {
      drugRowId = drugRow.id;
      const { data: shortages } = await supabase
        .from("shortage_events")
        .select("id, country, severity")
        .eq("status", "active")
        .eq("drug_id", drugId);

      shortageCount = shortages?.length ?? 0;
      countries = [...new Set(shortages?.map((s) => s.country).filter(Boolean))];
      critCount = shortages?.filter((s) => s.severity === "critical").length ?? 0;
      highCount = shortages?.filter((s) => s.severity === "high").length ?? 0;
    }
  } else if (!isDB) {
    /* Placeholder amoxicillin article — use ilike search */
    const { data: shortages } = await supabase
      .from("shortage_events")
      .select("id, country, severity")
      .eq("status", "active")
      .ilike("drug_name", "%amoxicillin%");

    shortageCount = shortages?.length ?? 0;
    countries = [...new Set(shortages?.map((s) => s.country).filter(Boolean))];
    critCount = shortages?.filter((s) => s.severity === "critical").length ?? 0;
    highCount = shortages?.filter((s) => s.severity === "high").length ?? 0;

    const { data: drugRow } = await supabase
      .from("drugs")
      .select("id")
      .ilike("generic_name", "%amoxicillin%")
      .limit(1)
      .single();
    drugRowId = drugRow?.id ?? null;
  }

  /* ── Related articles: DB articles in same category, or placeholders ── */
  let relatedCards: InsightCard[] = [];
  if (isDB) {
    const { data: relatedRows } = await supabase
      .from("intelligence_articles")
      .select("slug, title, description, category, author, read_time, published_at")
      .eq("status", "published")
      .eq("category", articleCategory)
      .neq("slug", slug)
      .order("published_at", { ascending: false })
      .limit(3);
    relatedCards = (relatedRows ?? []).map((r) => ({
      slug: r.slug,
      category: r.category as Category,
      title: r.title,
      date: r.published_at ? new Date(r.published_at).toLocaleDateString("en-AU", { month: "long", year: "numeric" }) : "",
      description: r.description,
      author: r.author,
      readTime: r.read_time ?? undefined,
    }));
  }
  if (relatedCards.length === 0) relatedCards = RELATED_ARTICLES;

  const catStyle = CATEGORY_STYLE[articleCategory];

  return (
    <div style={{ background: "#fff", minHeight: "100vh" }}>
      <SiteNav />

      {/* ─── Article header ─── */}
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "40px 32px 0" }}>
        {/* Breadcrumb */}
        <nav style={{ fontSize: 13, color: "#94a3b8", marginBottom: 40, display: "flex", alignItems: "center", gap: 6 }}>
          <Link href="/intelligence" style={{ color: "var(--teal)", textDecoration: "none", fontWeight: 500 }}>Intelligence</Link>
          <span>&rsaquo;</span>
          <span>{catStyle.label}</span>
        </nav>
      </div>

      <div className="intel-article-layout" style={{
        maxWidth: 1200, margin: "0 auto", padding: "0 32px 80px",
        display: "grid", gridTemplateColumns: "1fr 300px", gap: 64,
      }}>
        {/* ─── Main column ─── */}
        <article style={{ maxWidth: 680 }}>
          {/* Category tag */}
          <span style={{
            fontSize: 11, fontWeight: 600, letterSpacing: "0.08em",
            textTransform: "uppercase", color: catStyle.color,
          }}>
            {catStyle.label}
          </span>

          {/* Title */}
          <h1 style={{
            fontSize: "clamp(30px, 4vw, 44px)", fontWeight: 700,
            lineHeight: 1.12, letterSpacing: "-0.02em",
            color: "#0f172a", margin: "16px 0 20px",
          }}>
            {articleTitle}
          </h1>

          {/* Author + date */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 14, color: "#94a3b8", marginBottom: 36 }}>
            {articleAuthor && <span style={{ fontWeight: 500, color: "#475569" }}>{articleAuthor}</span>}
            <span>&middot;</span>
            <span>{articleDate}</span>
            {articleReadTime && <><span>&middot;</span><span>{articleReadTime}</span></>}
          </div>

          {/* ─── Live data callout ─── */}
          {shortageCount > 0 && (
            <div style={{
              background: "#f8fafc",
              borderLeft: "3px solid var(--teal)",
              borderRadius: "0 6px 6px 0",
              padding: "24px 28px", marginBottom: 40,
            }}>
              <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.10em", color: "var(--teal)", marginBottom: 14 }}>
                Live data — updated in real time
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 28 }}>
                <div>
                  <div style={{ fontSize: 32, fontWeight: 700, color: "#0f172a", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{shortageCount}</div>
                  <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>active shortages</div>
                </div>
                <div>
                  <div style={{ fontSize: 32, fontWeight: 700, color: "#0f172a", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{countries.length}</div>
                  <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>countries affected</div>
                </div>
                <div>
                  <div style={{ fontSize: 32, fontWeight: 700, color: "var(--crit)", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{critCount}</div>
                  <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>critical</div>
                </div>
                <div>
                  <div style={{ fontSize: 32, fontWeight: 700, color: "var(--high)", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{highCount}</div>
                  <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>high severity</div>
                </div>
              </div>
              {countries.length > 0 && (
                <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 14 }}>
                  Affected: {countries.join(", ")}
                </div>
              )}
            </div>
          )}

          {/* Hero image placeholder */}
          <div style={{
            width: "100%", height: 360, background: "#f1f5f9",
            borderRadius: 6,
            display: "flex", alignItems: "center", justifyContent: "center",
            marginBottom: 48,
          }}>
            <span style={{ fontSize: 13, color: "#94a3b8" }}>Image</span>
          </div>

          {/* ─── Article body ─── */}
          {sections.map((section, i) => (
            <div key={i} style={{ marginBottom: 8 }}>
              {section.heading && (
                <h2 style={{
                  fontSize: 22, fontWeight: 700, color: "#0f172a",
                  letterSpacing: "-0.015em", margin: "44px 0 16px",
                  lineHeight: 1.25,
                }}>
                  {section.heading}
                </h2>
              )}
              <p style={{
                fontSize: i === 0 ? 18 : 16,
                lineHeight: 1.85,
                color: i === 0 ? "#334155" : "#475569",
                margin: 0,
              }}>
                {section.body}
              </p>

              {/* Pull quote after section 2 */}
              {i === 1 && pullQuote && (
                <blockquote style={{
                  margin: "44px 0",
                  padding: "0 0 0 28px",
                  borderLeft: "3px solid var(--teal)",
                }}>
                  <p style={{
                    fontSize: "clamp(19px, 2.5vw, 24px)", fontWeight: 500,
                    fontStyle: "italic", lineHeight: 1.55,
                    color: "#0f172a", margin: 0,
                  }}>
                    &ldquo;{pullQuote}&rdquo;
                  </p>
                </blockquote>
              )}
            </div>
          ))}

          {/* Bottom CTA */}
          <div style={{
            marginTop: 56, padding: "36px 40px",
            borderRadius: 8,
            background: "#0f172a",
          }}>
            <div style={{
              fontSize: 20, fontWeight: 650, color: "#f1f5f9", marginBottom: 10,
              lineHeight: 1.3,
            }}>
              Explore the data behind this article
            </div>
            <p style={{ fontSize: 14, color: "rgba(255,255,255,0.45)", margin: "0 0 24px", lineHeight: 1.6 }}>
              Search real-time shortage data across 20+ countries on the Mederti platform.
            </p>
            <div style={{ display: "flex", gap: 12 }}>
              <Link href="/dashboard" style={{
                display: "inline-flex", alignItems: "center",
                padding: "11px 28px", borderRadius: 6,
                fontSize: 14, fontWeight: 600,
                color: "#fff", textDecoration: "none",
                background: "var(--teal)",
              }}>
                Go to Dashboard
              </Link>
              {drugRowId && drugName && (
                <Link href={`/drugs/${drugRowId}`} style={{
                  display: "inline-flex", alignItems: "center",
                  padding: "11px 28px", borderRadius: 6,
                  fontSize: 14, fontWeight: 600,
                  color: "rgba(255,255,255,0.7)", textDecoration: "none",
                  border: "1px solid rgba(255,255,255,0.2)",
                }}>
                  View {drugName} &rarr;
                </Link>
              )}
            </div>
          </div>
        </article>

        {/* ─── Sidebar ─── */}
        <aside className="intel-article-sidebar">
          {/* Live shortage status */}
          {drugRowId && shortageCount > 0 && (
            <div style={{
              borderLeft: "3px solid var(--teal)",
              padding: "20px",
              marginBottom: 36,
              background: "#f8fafc",
              borderRadius: "0 6px 6px 0",
            }}>
              <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.10em", color: "var(--teal)", marginBottom: 12 }}>
                Live shortage status
              </div>
              <div style={{
                fontSize: 16, fontWeight: 650, color: "#0f172a", marginBottom: 8,
              }}>
                {drugName}
              </div>
              <div style={{ fontSize: 13, color: "#64748b", marginBottom: 4, lineHeight: 1.5 }}>
                {shortageCount} active shortage{shortageCount !== 1 ? "s" : ""} across {countries.length} countr{countries.length !== 1 ? "ies" : "y"}
              </div>
              <Link href={`/drugs/${drugRowId}`} style={{
                display: "inline-block", marginTop: 12,
                fontSize: 13, fontWeight: 600, color: "var(--teal)", textDecoration: "none",
              }}>
                View drug page &rarr;
              </Link>
            </div>
          )}

          {/* Related articles */}
          <div style={{ marginBottom: 36 }}>
            <div style={{
              fontSize: 11, fontWeight: 600, letterSpacing: "0.12em",
              textTransform: "uppercase", color: "#94a3b8",
              marginBottom: 20, paddingBottom: 12,
              borderBottom: "2px solid #0f172a",
            }}>
              Related
            </div>
            {relatedCards.map((ra, i) => (
              <div key={ra.slug} style={{
                padding: "18px 0",
                borderBottom: i < relatedCards.length - 1 ? "1px solid #e5e7eb" : "none",
              }}>
                <span style={{
                  fontSize: 10, fontWeight: 600, letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: CATEGORY_STYLE[ra.category].color,
                }}>
                  {CATEGORY_STYLE[ra.category].label}
                </span>
                <div style={{
                  fontSize: 15, fontWeight: 650, color: "#0f172a",
                  lineHeight: 1.35, margin: "8px 0 6px",
                }}>
                  {ra.title}
                </div>
                <div style={{ fontSize: 12, color: "#94a3b8" }}>{ra.date}</div>
              </div>
            ))}
          </div>

          {/* Newsletter sidebar CTA */}
          <div style={{
            background: "#0f172a", borderRadius: 8,
            padding: "24px 20px", textAlign: "center",
          }}>
            <div style={{
              fontSize: 11, fontWeight: 600, letterSpacing: "0.10em",
              textTransform: "uppercase", color: "var(--teal)",
              marginBottom: 10,
            }}>
              Newsletter
            </div>
            <div style={{
              fontSize: 16, fontWeight: 650, color: "#fff",
              lineHeight: 1.35, marginBottom: 16,
            }}>
              Weekly intelligence briefing
            </div>
            <input
              type="email"
              placeholder="you@hospital.org"
              style={{
                width: "100%", padding: "10px 14px",
                borderRadius: 6, border: "1px solid rgba(255,255,255,0.15)",
                background: "rgba(255,255,255,0.06)",
                color: "#fff", fontSize: 13,
                outline: "none", marginBottom: 10,
                boxSizing: "border-box",
              }}
            />
            <button style={{
              width: "100%", padding: "10px 0", borderRadius: 6,
              border: "none", background: "var(--teal)",
              color: "#fff", fontSize: 13, fontWeight: 600,
              cursor: "pointer",
            }}>
              Subscribe
            </button>
          </div>
        </aside>
      </div>

      {/* ─── NEWSLETTER FOOTER ─── */}
      <div style={{
        background: "#0f172a",
        padding: "64px 32px",
      }}>
        <div style={{
          maxWidth: 560, margin: "0 auto", textAlign: "center",
        }}>
          <div style={{
            fontSize: "clamp(22px, 3vw, 28px)", fontWeight: 650,
            color: "#fff", lineHeight: 1.3,
            marginBottom: 12,
          }}>
            Get the Mederti Intelligence briefing every Monday.
          </div>
          <p style={{
            fontSize: 14, color: "rgba(255,255,255,0.4)",
            lineHeight: 1.6, margin: "0 0 28px",
          }}>
            Shortage alerts, new data releases and analysis — one concise email per week.
          </p>
          <div className="intel-newsletter-form" style={{
            display: "flex", gap: 10,
            justifyContent: "center",
          }}>
            <input
              type="email"
              placeholder="you@hospital.org"
              style={{
                width: 280, padding: "12px 16px",
                borderRadius: 6, border: "1px solid rgba(255,255,255,0.15)",
                background: "rgba(255,255,255,0.06)",
                color: "#fff", fontSize: 14,
                outline: "none",
              }}
            />
            <button style={{
              padding: "12px 24px", borderRadius: 6,
              border: "none", background: "var(--teal)",
              color: "#fff", fontSize: 14, fontWeight: 600,
              cursor: "pointer",
            }}>
              Subscribe
            </button>
          </div>
          <div style={{
            fontSize: 12, color: "rgba(255,255,255,0.25)",
            marginTop: 16,
          }}>
            No spam. Unsubscribe anytime.
          </div>
        </div>
      </div>

      <SiteFooter />

      <style>{`
        @media (max-width: 860px) {
          .intel-article-layout {
            grid-template-columns: 1fr !important;
            gap: 40px !important;
          }
          .intel-article-sidebar {
            order: -1;
          }
          .intel-newsletter-form { flex-direction: column !important; align-items: center !important; }
          .intel-newsletter-form input { width: 100% !important; max-width: 320px !important; }
        }
      `}</style>
    </div>
  );
}
