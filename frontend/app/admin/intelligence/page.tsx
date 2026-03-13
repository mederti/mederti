"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Shield, LogIn, ChevronDown, ChevronUp, Check, X, Eye } from "lucide-react";
import { createBrowserClient } from "@/lib/supabase/client";
import SiteNav from "@/app/components/landing-nav";
import SiteFooter from "@/app/components/site-footer";

/* ── Types ── */

interface Article {
  id: string;
  slug: string;
  title: string;
  description: string;
  category: string;
  content_type: string;
  status: string;
  drug_name: string | null;
  author: string;
  read_time: string | null;
  created_at: string;
  published_at: string | null;
}

interface FullArticle extends Article {
  body_json: { heading?: string; body: string }[];
  source_data: Record<string, unknown> | null;
  pull_quote: string | null;
}

const TABS = ["all", "draft", "published", "rejected"] as const;
type Tab = (typeof TABS)[number];

const STATUS_COLORS: Record<string, { bg: string; fg: string; border: string }> = {
  draft:     { bg: "var(--amber-bg, #fef3c7)", fg: "var(--amber, #d97706)", border: "var(--amber-b, #fde68a)" },
  published: { bg: "var(--teal-bg)",            fg: "var(--teal)",           border: "var(--teal-b)" },
  rejected:  { bg: "#fef2f2",                   fg: "#dc2626",              border: "#fecaca" },
};

const CATEGORY_LABELS: Record<string, string> = {
  article: "Article",
  report: "Report",
  data: "Data",
  media: "Media",
};

/* ── Component ── */

export default function AdminIntelligencePage() {
  const supabase = createBrowserClient();

  const [authed, setAuthed]         = useState<boolean | null>(null);
  const [email, setEmail]           = useState<string | null>(null);
  const [tab, setTab]               = useState<Tab>("all");
  const [articles, setArticles]     = useState<Article[]>([]);
  const [total, setTotal]           = useState(0);
  const [page, setPage]             = useState(1);
  const [loading, setLoading]       = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [preview, setPreview]       = useState<FullArticle | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [actionLoading, setActionLoading]   = useState<string | null>(null);

  /* Auth check */
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setAuthed(true);
        setEmail(session.user.email ?? null);
      } else {
        setAuthed(false);
      }
    });
  }, [supabase.auth]);

  /* Fetch articles */
  const fetchArticles = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page) });
    if (tab !== "all") params.set("status", tab);

    const res = await fetch(`/api/admin/intelligence?${params}`);
    if (res.ok) {
      const json = await res.json();
      setArticles(json.articles);
      setTotal(json.total);
    }
    setLoading(false);
  }, [tab, page]);

  useEffect(() => {
    if (authed) fetchArticles();
  }, [authed, fetchArticles]);

  /* Expand / preview */
  const togglePreview = async (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      setPreview(null);
      return;
    }
    setExpandedId(id);
    setPreview(null);
    setPreviewLoading(true);
    const res = await fetch(`/api/admin/intelligence/${id}`);
    if (res.ok) setPreview(await res.json());
    setPreviewLoading(false);
  };

  /* Publish / reject */
  const handleAction = async (id: string, action: "publish" | "reject") => {
    setActionLoading(id);
    await fetch("/api/admin/intelligence", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action, reviewerEmail: email }),
    });
    setActionLoading(null);
    fetchArticles();
  };

  const pageSize = 20;
  const totalPages = Math.ceil(total / pageSize);

  return (
    <div style={{ background: "var(--app-bg)", minHeight: "100vh", color: "var(--app-text)" }}>
      <SiteNav />

      {/* Header */}
      <div style={{ background: "#fff", borderBottom: "1px solid var(--app-border)" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "32px 32px 28px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <Shield style={{ width: 20, height: 20, color: "var(--teal)" }} strokeWidth={1.8} />
            <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Intelligence Admin</h1>
          </div>
          <p style={{ fontSize: 14, color: "var(--app-text-3)", margin: 0 }}>
            Review, publish, or reject AI-generated intelligence articles.
          </p>
        </div>
      </div>

      {/* Content */}
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 32px 48px" }}>

        {/* Loading auth */}
        {authed === null && (
          <div style={{ padding: "48px 0", textAlign: "center" }}>
            <div style={{
              width: 24, height: 24, borderRadius: "50%",
              border: "2px solid var(--teal)", borderTopColor: "transparent",
              animation: "spin 0.7s linear infinite", margin: "0 auto",
            }} />
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        )}

        {/* Not signed in */}
        {authed === false && (
          <div style={{
            background: "#fff", border: "1px solid var(--app-border)", borderRadius: 12,
            padding: "64px 24px", textAlign: "center", maxWidth: 460, margin: "0 auto",
          }}>
            <div style={{
              width: 52, height: 52, borderRadius: "50%",
              background: "var(--teal-bg)", border: "1px solid var(--teal-b)",
              display: "flex", alignItems: "center", justifyContent: "center",
              margin: "0 auto 18px",
            }}>
              <Shield style={{ width: 22, height: 22 }} color="var(--teal)" strokeWidth={1.6} />
            </div>
            <h2 style={{ fontSize: 17, fontWeight: 600, margin: "0 0 8px" }}>
              Sign in to access admin
            </h2>
            <p style={{ fontSize: 14, color: "var(--app-text-3)", marginBottom: 24, lineHeight: 1.6 }}>
              Sign in to review and manage intelligence articles.
            </p>
            <Link href="/login?next=/admin/intelligence" style={{
              display: "inline-flex", alignItems: "center", gap: 7,
              padding: "10px 22px", borderRadius: 8,
              background: "var(--teal)", color: "#fff",
              fontSize: 14, fontWeight: 600, textDecoration: "none",
            }}>
              <LogIn style={{ width: 15, height: 15 }} strokeWidth={1.5} />
              Sign in
            </Link>
          </div>
        )}

        {/* Signed in — admin content */}
        {authed === true && (
          <div>
            {/* Filter tabs */}
            <div style={{ display: "flex", gap: 4, marginBottom: 20 }}>
              {TABS.map((t) => (
                <button
                  key={t}
                  onClick={() => { setTab(t); setPage(1); setExpandedId(null); setPreview(null); }}
                  style={{
                    padding: "7px 16px", borderRadius: 6, fontSize: 13, fontWeight: 500,
                    border: "1px solid",
                    borderColor: tab === t ? "var(--teal)" : "var(--app-border)",
                    background: tab === t ? "var(--teal-bg)" : "#fff",
                    color: tab === t ? "var(--teal)" : "var(--app-text-3)",
                    cursor: "pointer", textTransform: "capitalize",
                  }}
                >
                  {t === "all" ? "All" : t}
                </button>
              ))}
              <div style={{ marginLeft: "auto", fontSize: 13, color: "var(--app-text-4)", alignSelf: "center" }}>
                {total} article{total !== 1 ? "s" : ""}
              </div>
            </div>

            {/* Loading */}
            {loading && (
              <div style={{ padding: "32px 0", textAlign: "center" }}>
                <div style={{
                  width: 20, height: 20, borderRadius: "50%",
                  border: "2px solid var(--teal)", borderTopColor: "transparent",
                  animation: "spin 0.7s linear infinite", margin: "0 auto",
                }} />
              </div>
            )}

            {/* Empty state */}
            {!loading && articles.length === 0 && (
              <div style={{
                padding: "48px 0", textAlign: "center",
                fontSize: 14, color: "var(--app-text-4)",
              }}>
                No {tab === "all" ? "" : tab + " "}articles found.
              </div>
            )}

            {/* Article list */}
            {!loading && articles.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                {/* Table header */}
                <div style={{
                  display: "grid", gridTemplateColumns: "80px 1fr 140px 100px 110px 80px 140px",
                  gap: 12, padding: "10px 16px",
                  fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em",
                  color: "var(--app-text-4)", borderBottom: "1px solid var(--app-border)",
                }}>
                  <span>Category</span>
                  <span>Title</span>
                  <span>Drug</span>
                  <span>Type</span>
                  <span>Date</span>
                  <span>Status</span>
                  <span>Actions</span>
                </div>

                {articles.map((a) => {
                  const isExpanded = expandedId === a.id;
                  const sc = STATUS_COLORS[a.status] ?? STATUS_COLORS.draft;
                  return (
                    <div key={a.id} style={{ borderBottom: "1px solid var(--app-border)" }}>
                      {/* Row */}
                      <div style={{
                        display: "grid", gridTemplateColumns: "80px 1fr 140px 100px 110px 80px 140px",
                        gap: 12, padding: "14px 16px", alignItems: "center",
                        background: isExpanded ? "var(--app-bg-2)" : "#fff",
                      }}>
                        {/* Category */}
                        <span style={{
                          fontSize: 11, fontWeight: 600, textTransform: "uppercase",
                          letterSpacing: "0.04em", color: "var(--app-text-4)",
                        }}>
                          {CATEGORY_LABELS[a.category] ?? a.category}
                        </span>

                        {/* Title (clickable) */}
                        <button
                          onClick={() => togglePreview(a.id)}
                          style={{
                            all: "unset", cursor: "pointer", display: "flex", alignItems: "center", gap: 6,
                            fontSize: 14, fontWeight: 600, color: "var(--app-text)",
                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                          }}
                        >
                          {isExpanded ? <ChevronUp style={{ width: 14, height: 14, flexShrink: 0 }} /> : <ChevronDown style={{ width: 14, height: 14, flexShrink: 0 }} />}
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{a.title}</span>
                        </button>

                        {/* Drug */}
                        <span style={{ fontSize: 13, color: "var(--app-text-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {a.drug_name ?? "—"}
                        </span>

                        {/* Content type */}
                        <span style={{ fontSize: 12, color: "var(--app-text-4)", fontFamily: "var(--font-dm-mono)", textTransform: "lowercase" }}>
                          {a.content_type}
                        </span>

                        {/* Date */}
                        <span style={{ fontSize: 12, color: "var(--app-text-4)" }}>
                          {new Date(a.created_at).toLocaleDateString("en-AU", { day: "numeric", month: "short" })}
                        </span>

                        {/* Status badge */}
                        <span style={{
                          display: "inline-block", fontSize: 11, fontWeight: 600,
                          padding: "3px 8px", borderRadius: 4, textTransform: "capitalize",
                          background: sc.bg, color: sc.fg, border: `1px solid ${sc.border}`,
                        }}>
                          {a.status}
                        </span>

                        {/* Actions */}
                        <div style={{ display: "flex", gap: 6 }}>
                          {a.status === "draft" && (
                            <>
                              <button
                                disabled={actionLoading === a.id}
                                onClick={() => handleAction(a.id, "publish")}
                                style={{
                                  display: "inline-flex", alignItems: "center", gap: 4,
                                  padding: "5px 10px", borderRadius: 5, fontSize: 12, fontWeight: 600,
                                  background: "var(--teal)", color: "#fff", border: "none", cursor: "pointer",
                                  opacity: actionLoading === a.id ? 0.5 : 1,
                                }}
                              >
                                <Check style={{ width: 12, height: 12 }} strokeWidth={2} />
                                Publish
                              </button>
                              <button
                                disabled={actionLoading === a.id}
                                onClick={() => handleAction(a.id, "reject")}
                                style={{
                                  display: "inline-flex", alignItems: "center", gap: 4,
                                  padding: "5px 10px", borderRadius: 5, fontSize: 12, fontWeight: 600,
                                  background: "#fff", color: "#dc2626", border: "1px solid #fecaca", cursor: "pointer",
                                  opacity: actionLoading === a.id ? 0.5 : 1,
                                }}
                              >
                                <X style={{ width: 12, height: 12 }} strokeWidth={2} />
                                Reject
                              </button>
                            </>
                          )}
                          {a.status === "published" && (
                            <Link href={`/intelligence/${a.slug}`} style={{
                              display: "inline-flex", alignItems: "center", gap: 4,
                              padding: "5px 10px", borderRadius: 5, fontSize: 12, fontWeight: 600,
                              background: "#fff", color: "var(--teal)", border: "1px solid var(--teal-b)",
                              textDecoration: "none",
                            }}>
                              <Eye style={{ width: 12, height: 12 }} strokeWidth={2} />
                              View
                            </Link>
                          )}
                        </div>
                      </div>

                      {/* Expanded preview */}
                      {isExpanded && (
                        <div style={{
                          padding: "20px 16px 24px 32px",
                          background: "var(--app-bg-2)",
                          borderTop: "1px solid var(--app-border)",
                        }}>
                          {previewLoading && (
                            <div style={{ fontSize: 13, color: "var(--app-text-4)" }}>Loading preview...</div>
                          )}
                          {preview && preview.id === a.id && (
                            <div style={{ maxWidth: 720 }}>
                              {/* Description */}
                              <p style={{ fontSize: 14, color: "var(--app-text-2)", lineHeight: 1.7, margin: "0 0 20px" }}>
                                {preview.description}
                              </p>

                              {/* Pull quote */}
                              {preview.pull_quote && (
                                <blockquote style={{
                                  margin: "0 0 20px", padding: "12px 0 12px 20px",
                                  borderLeft: "3px solid var(--teal)",
                                  fontSize: 15, fontStyle: "italic", color: "var(--app-text-2)", lineHeight: 1.6,
                                }}>
                                  {preview.pull_quote}
                                </blockquote>
                              )}

                              {/* Body sections */}
                              {preview.body_json?.map((section, i) => (
                                <div key={i} style={{ marginBottom: 18 }}>
                                  {section.heading && (
                                    <h3 style={{ fontSize: 16, fontWeight: 700, margin: "0 0 8px", color: "var(--app-text)" }}>
                                      {section.heading}
                                    </h3>
                                  )}
                                  <p style={{ fontSize: 14, color: "var(--app-text-2)", lineHeight: 1.7, margin: 0 }}>
                                    {section.body}
                                  </p>
                                </div>
                              ))}

                              {/* Source data collapsible */}
                              {preview.source_data && (
                                <details style={{ marginTop: 20 }}>
                                  <summary style={{
                                    fontSize: 12, fontWeight: 600, color: "var(--app-text-4)",
                                    cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.05em",
                                  }}>
                                    Source data (for verification)
                                  </summary>
                                  <pre style={{
                                    marginTop: 10, padding: 16, borderRadius: 8,
                                    background: "#1e293b", color: "#e2e8f0", fontSize: 12,
                                    overflow: "auto", maxHeight: 300, lineHeight: 1.5,
                                    fontFamily: "var(--font-dm-mono)",
                                  }}>
                                    {JSON.stringify(preview.source_data, null, 2)}
                                  </pre>
                                </details>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Pagination */}
            {totalPages > 1 && (
              <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 24 }}>
                <button
                  disabled={page <= 1}
                  onClick={() => setPage(page - 1)}
                  style={{
                    padding: "6px 14px", borderRadius: 6, fontSize: 13, fontWeight: 500,
                    border: "1px solid var(--app-border)", background: "#fff",
                    color: page <= 1 ? "var(--app-text-4)" : "var(--app-text)", cursor: page <= 1 ? "default" : "pointer",
                  }}
                >
                  Previous
                </button>
                <span style={{ fontSize: 13, color: "var(--app-text-3)", alignSelf: "center" }}>
                  Page {page} of {totalPages}
                </span>
                <button
                  disabled={page >= totalPages}
                  onClick={() => setPage(page + 1)}
                  style={{
                    padding: "6px 14px", borderRadius: 6, fontSize: 13, fontWeight: 500,
                    border: "1px solid var(--app-border)", background: "#fff",
                    color: page >= totalPages ? "var(--app-text-4)" : "var(--app-text)", cursor: page >= totalPages ? "default" : "pointer",
                  }}
                >
                  Next
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <SiteFooter />

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
