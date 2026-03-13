import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import SiteNav from "@/app/components/landing-nav";
import SiteFooter from "@/app/components/site-footer";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  AMOXICILLIN_ARTICLE,
  RELATED_ARTICLES,
  CATEGORY_STYLE,
} from "../data";

/* ── article lookup (only one article for now) ── */
const ALL_ARTICLES: Record<string, typeof AMOXICILLIN_ARTICLE> = {
  [AMOXICILLIN_ARTICLE.slug]: AMOXICILLIN_ARTICLE,
};

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const article = ALL_ARTICLES[slug];
  if (!article) return { title: "Not Found" };
  return {
    title: `${article.title} \u2014 Mederti Intelligence`,
    description: article.metaDescription,
  };
}

export default async function IntelligenceArticlePage({ params }: Props) {
  const { slug } = await params;
  const article = ALL_ARTICLES[slug];
  if (!article) notFound();

  /* ── Live data callout — amoxicillin shortage stats ── */
  const supabase = getSupabaseAdmin();
  const { data: shortages } = await supabase
    .from("shortage_events")
    .select("id, country, severity")
    .eq("status", "active")
    .ilike("drug_name", "%amoxicillin%");

  const shortageCount = shortages?.length ?? 0;
  const countries = [...new Set(shortages?.map((s) => s.country).filter(Boolean))];
  const critCount = shortages?.filter((s) => s.severity === "critical").length ?? 0;
  const highCount = shortages?.filter((s) => s.severity === "high").length ?? 0;

  /* Find an amoxicillin drug record to link to */
  const { data: drugRow } = await supabase
    .from("drugs")
    .select("id")
    .ilike("generic_name", "%amoxicillin%")
    .limit(1)
    .single();

  const catStyle = CATEGORY_STYLE[article.category];

  return (
    <div style={{ background: "#fff", minHeight: "100vh", fontFamily: "var(--font-inter, system-ui, sans-serif)" }}>
      <SiteNav />

      <div style={{ maxWidth: 1080, margin: "0 auto", padding: "40px 24px 80px" }}>
        {/* ─── Breadcrumb ─── */}
        <nav style={{ fontSize: 13, color: "var(--app-text-4)", marginBottom: 32, display: "flex", alignItems: "center", gap: 6 }}>
          <Link href="/intelligence" style={{ color: "var(--teal)", textDecoration: "none", fontWeight: 500 }}>Intelligence</Link>
          <span>&rsaquo;</span>
          <span>{catStyle.label}</span>
          <span>&rsaquo;</span>
          <span style={{ color: "var(--app-text-3)" }}>{article.title.split(":")[0]}</span>
        </nav>

        <div className="intel-article-layout" style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 56 }}>
          {/* ─── Main column ─── */}
          <article>
            {/* Category pill */}
            <span style={{
              display: "inline-block", fontSize: 11, fontWeight: 600,
              padding: "3px 10px", borderRadius: 20, marginBottom: 20,
              color: catStyle.color, background: catStyle.bg,
            }}>
              {catStyle.label}
            </span>

            <h1 style={{
              fontSize: "clamp(28px,4vw,40px)", fontWeight: 750,
              lineHeight: 1.12, letterSpacing: "-0.03em",
              color: "var(--app-text)", margin: "0 0 20px",
            }}>
              {article.title}
            </h1>

            <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 13, color: "var(--app-text-4)", marginBottom: 32 }}>
              {article.author && <span style={{ fontWeight: 500, color: "var(--app-text-3)" }}>{article.author}</span>}
              <span>&middot;</span>
              <span>{article.date}</span>
              <span>&middot;</span>
              <span>{article.readTime}</span>
            </div>

            {/* ─── Live data callout ─── */}
            {shortageCount > 0 && (
              <div style={{
                background: "var(--teal-bg)", border: "1px solid var(--teal-b, rgba(13,148,136,0.2))",
                borderRadius: 10, padding: "20px 24px", marginBottom: 36,
              }}>
                <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.10em", color: "var(--teal)", marginBottom: 10 }}>
                  Live data
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 24 }}>
                  <div>
                    <div style={{ fontSize: 28, fontWeight: 700, color: "var(--app-text)", lineHeight: 1 }}>{shortageCount}</div>
                    <div style={{ fontSize: 12, color: "var(--app-text-3)", marginTop: 4 }}>active shortages</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 28, fontWeight: 700, color: "var(--app-text)", lineHeight: 1 }}>{countries.length}</div>
                    <div style={{ fontSize: 12, color: "var(--app-text-3)", marginTop: 4 }}>countries affected</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 28, fontWeight: 700, color: "var(--crit)", lineHeight: 1 }}>{critCount}</div>
                    <div style={{ fontSize: 12, color: "var(--app-text-3)", marginTop: 4 }}>critical</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 28, fontWeight: 700, color: "var(--high)", lineHeight: 1 }}>{highCount}</div>
                    <div style={{ fontSize: 12, color: "var(--app-text-3)", marginTop: 4 }}>high severity</div>
                  </div>
                </div>
                {countries.length > 0 && (
                  <div style={{ fontSize: 12, color: "var(--app-text-4)", marginTop: 12 }}>
                    Affected: {countries.join(", ")}
                  </div>
                )}
              </div>
            )}

            {/* Hero image placeholder */}
            <div style={{
              width: "100%", height: 320, background: "var(--app-bg)",
              borderRadius: 10, border: "1px solid var(--app-border)",
              display: "flex", alignItems: "center", justifyContent: "center",
              marginBottom: 40,
            }}>
              <span style={{ fontSize: 13, color: "var(--app-text-4)" }}>Image</span>
            </div>

            {/* Article body */}
            {article.sections.map((section, i) => (
              <div key={i} style={{ marginBottom: 28 }}>
                {section.heading && (
                  <h2 style={{
                    fontSize: 20, fontWeight: 700, color: "var(--app-text)",
                    letterSpacing: "-0.015em", margin: "36px 0 14px",
                  }}>
                    {section.heading}
                  </h2>
                )}
                <p style={{ fontSize: 16, lineHeight: 1.8, color: "var(--app-text-2)", margin: 0 }}>
                  {section.body}
                </p>

                {/* Pull quote after section 2 */}
                {i === 1 && article.pullQuote && (
                  <blockquote style={{
                    margin: "36px 0",
                    padding: "24px 28px",
                    borderLeft: "3px solid var(--teal)",
                    background: "var(--app-bg)",
                    borderRadius: "0 10px 10px 0",
                  }}>
                    <p style={{
                      fontSize: "clamp(17px,2vw,20px)", fontWeight: 500,
                      fontStyle: "italic", lineHeight: 1.6,
                      color: "var(--app-text)", margin: 0,
                    }}>
                      &ldquo;{article.pullQuote}&rdquo;
                    </p>
                  </blockquote>
                )}
              </div>
            ))}

            {/* Bottom CTA */}
            <div style={{
              marginTop: 48, padding: "32px", borderRadius: 12,
              background: "#0f172a", textAlign: "center",
            }}>
              <div style={{ fontSize: 18, fontWeight: 650, color: "#f0f4f8", marginBottom: 12 }}>
                Explore the data behind this article
              </div>
              <p style={{ fontSize: 14, color: "rgba(255,255,255,0.5)", margin: "0 0 20px", lineHeight: 1.6 }}>
                Search real-time shortage data across 13 countries on the Mederti platform.
              </p>
              <Link href="/dashboard" style={{
                display: "inline-flex", alignItems: "center",
                padding: "12px 32px", borderRadius: 8,
                fontSize: 14, fontWeight: 600,
                color: "#fff", textDecoration: "none",
                background: "var(--teal)",
              }}>
                Go to Dashboard
              </Link>
            </div>
          </article>

          {/* ─── Sidebar ─── */}
          <aside className="intel-article-sidebar">
            {/* Live shortage status */}
            {drugRow?.id && (
              <div style={{
                border: "1px solid var(--app-border)", borderRadius: 10,
                padding: "20px", marginBottom: 28,
              }}>
                <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.10em", color: "var(--teal)", marginBottom: 12 }}>
                  Live shortage status
                </div>
                <div style={{ fontSize: 15, fontWeight: 600, color: "var(--app-text)", marginBottom: 8 }}>
                  Amoxicillin
                </div>
                <div style={{ fontSize: 13, color: "var(--app-text-3)", marginBottom: 4 }}>
                  {shortageCount} active shortage{shortageCount !== 1 ? "s" : ""} across {countries.length} countr{countries.length !== 1 ? "ies" : "y"}
                </div>
                <Link href={`/drugs/${drugRow.id}`} style={{
                  display: "inline-block", marginTop: 12,
                  fontSize: 13, fontWeight: 600, color: "var(--teal)", textDecoration: "none",
                }}>
                  View drug page &rarr;
                </Link>
              </div>
            )}

            {/* Related articles */}
            <div style={{ marginBottom: 28 }}>
              <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.10em", color: "var(--app-text-4)", marginBottom: 16 }}>
                Related
              </div>
              {RELATED_ARTICLES.map((ra) => (
                <div key={ra.slug} style={{
                  padding: "16px 0",
                  borderBottom: "1px solid var(--app-border)",
                }}>
                  <span style={{
                    display: "inline-block", fontSize: 10, fontWeight: 600,
                    padding: "2px 8px", borderRadius: 20, marginBottom: 8,
                    color: CATEGORY_STYLE[ra.category].color,
                    background: CATEGORY_STYLE[ra.category].bg,
                  }}>
                    {CATEGORY_STYLE[ra.category].label}
                  </span>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "var(--app-text)", lineHeight: 1.35, marginBottom: 4 }}>
                    {ra.title}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--app-text-4)" }}>{ra.date}</div>
                </div>
              ))}
            </div>
          </aside>
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
        }
      `}</style>
    </div>
  );
}
