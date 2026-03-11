import Link from "next/link";
import { AlertCircle } from "lucide-react";
import { api, ShortageListResponse } from "@/lib/api";
import SiteNav from "@/app/components/landing-nav";

interface SearchParams {
  country?: string;
  status?: string;
  severity?: string;
  page?: string;
}

interface Props {
  searchParams: Promise<SearchParams>;
}

const SEVERITY_ORDER = ["critical", "high", "medium", "low"] as const;
type SeverityKey = (typeof SEVERITY_ORDER)[number];

const SEV_STYLES: Record<SeverityKey, { color: string; bg: string }> = {
  critical: { color: "#fff", bg: "var(--crit)" },
  high:     { color: "#fff", bg: "var(--high)" },
  medium:   { color: "#fff", bg: "var(--med)"  },
  low:      { color: "#fff", bg: "var(--low)"  },
};

function severityBadge(severity: string | null) {
  const key = (severity ?? "low").toLowerCase() as SeverityKey;
  const style = SEV_STYLES[key] ?? SEV_STYLES.low;
  return (
    <span style={{
      display: "inline-block",
      padding: "2px 9px",
      borderRadius: 20,
      fontSize: 11,
      fontWeight: 600,
      letterSpacing: "0.03em",
      textTransform: "capitalize",
      background: style.bg,
      color: style.color,
    }}>
      {severity ?? "low"}
    </span>
  );
}

function fmtDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

function buildUrl(base: SearchParams, overrides: Partial<SearchParams & { page: string }>) {
  const merged = { ...base, ...overrides };
  const params = new URLSearchParams();
  if (merged.country)  params.set("country",  merged.country);
  if (merged.status)   params.set("status",   merged.status);
  if (merged.severity) params.set("severity", merged.severity);
  if (merged.page)     params.set("page",     merged.page);
  const qs = params.toString();
  return `/shortages${qs ? "?" + qs : ""}`;
}

export default async function ShortagesPage({ searchParams }: Props) {
  const sp = await searchParams;
  const page       = Math.max(1, parseInt(sp.page ?? "1", 10));
  const pageSize   = 25;

  const fetchParams: Record<string, string | number> = {
    page,
    page_size: pageSize,
  };
  if (sp.country)  fetchParams.country  = sp.country;
  if (sp.status)   fetchParams.status   = sp.status;
  if (sp.severity) fetchParams.severity = sp.severity;

  let data: ShortageListResponse | null = null;
  try {
    data = await api.getShortages(fetchParams);
  } catch {
    // handled below
  }

  const results    = data?.results ?? [];
  const total      = data?.total   ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const STATUSES   = ["active", "resolved", "anticipated"] as const;
  const SEVERITIES = SEVERITY_ORDER;

  return (
    <div style={{ background: "var(--app-bg)", minHeight: "100vh", color: "var(--app-text)" }}>

      {/* Hero */}
      <div style={{ background: "var(--navy)" }}>
        <SiteNav />
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "32px 24px 28px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <AlertCircle style={{ width: 20, height: 20, color: "var(--teal-l)" }} strokeWidth={1.8} />
            <h1 style={{ fontSize: 22, fontWeight: 700, color: "#fff", margin: 0 }}>Drug Shortages</h1>
          </div>
          <p style={{ fontSize: 14, color: "rgba(255,255,255,0.55)", margin: 0 }}>
            {total.toLocaleString()} shortage{total !== 1 ? "s" : ""} across all monitored sources
          </p>
        </div>
      </div>

      {/* Filter chips */}
      <div style={{ background: "var(--navy-2)", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "12px 24px", display: "flex", gap: 20, flexWrap: "wrap", alignItems: "center" }}>

          {/* Status filters */}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.06em" }}>Status</span>
            <Link href={buildUrl(sp, { status: undefined, page: "1" })} style={{
              padding: "4px 10px", borderRadius: 20, fontSize: 12, textDecoration: "none", fontWeight: 500,
              background: !sp.status ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.04)",
              color: !sp.status ? "#fff" : "rgba(255,255,255,0.5)",
              border: "1px solid rgba(255,255,255,0.1)",
            }}>All</Link>
            {STATUSES.map(s => (
              <Link key={s} href={buildUrl(sp, { status: s, page: "1" })} style={{
                padding: "4px 10px", borderRadius: 20, fontSize: 12, textDecoration: "none", fontWeight: 500,
                textTransform: "capitalize",
                background: sp.status === s ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.04)",
                color: sp.status === s ? "#fff" : "rgba(255,255,255,0.5)",
                border: "1px solid rgba(255,255,255,0.1)",
              }}>{s}</Link>
            ))}
          </div>

          {/* Severity filters */}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.06em" }}>Severity</span>
            <Link href={buildUrl(sp, { severity: undefined, page: "1" })} style={{
              padding: "4px 10px", borderRadius: 20, fontSize: 12, textDecoration: "none", fontWeight: 500,
              background: !sp.severity ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.04)",
              color: !sp.severity ? "#fff" : "rgba(255,255,255,0.5)",
              border: "1px solid rgba(255,255,255,0.1)",
            }}>All</Link>
            {SEVERITIES.map(sev => {
              const style = SEV_STYLES[sev];
              const active = sp.severity === sev;
              return (
                <Link key={sev} href={buildUrl(sp, { severity: sev, page: "1" })} style={{
                  padding: "4px 10px", borderRadius: 20, fontSize: 12, textDecoration: "none",
                  fontWeight: 500, textTransform: "capitalize",
                  background: active ? style.bg : "rgba(255,255,255,0.04)",
                  color: active ? style.color : "rgba(255,255,255,0.5)",
                  border: `1px solid ${active ? style.bg : "rgba(255,255,255,0.1)"}`,
                }}>{sev}</Link>
              );
            })}
          </div>
        </div>
      </div>

      {/* Content */}
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 24px 48px" }}>
        <div style={{
          background: "var(--panel)",
          border: "1px solid var(--app-border)",
          borderRadius: 12,
          overflow: "hidden",
        }}>
          {results.length === 0 ? (
            <div style={{ padding: "64px 24px", textAlign: "center", color: "var(--app-text-3)" }}>
              <AlertCircle style={{ width: 36, height: 36, color: "var(--app-text-4)", margin: "0 auto 12px", display: "block" }} strokeWidth={1.5} />
              <p style={{ fontSize: 15, fontWeight: 500, color: "var(--app-text-2)", marginBottom: 6 }}>No shortages found</p>
              <p style={{ fontSize: 13 }}>Try adjusting the filters above.</p>
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--app-border)", background: "var(--app-bg)" }}>
                    {["Drug", "Severity", "Category", "Country", "Start", "Resolution"].map(col => (
                      <th key={col} style={{
                        padding: "11px 16px", textAlign: "left",
                        fontSize: 11, fontWeight: 600, color: "var(--app-text-4)",
                        textTransform: "uppercase", letterSpacing: "0.05em",
                        whiteSpace: "nowrap",
                      }}>
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {results.map((row, i) => (
                    <tr
                      key={row.shortage_id}
                      style={{
                        borderBottom: i < results.length - 1 ? "1px solid var(--app-border)" : "none",
                        transition: "background 0.1s",
                      }}
                      className="shortage-row"
                    >
                      <td style={{ padding: "12px 16px", minWidth: 180 }}>
                        <Link href={`/drugs/${row.drug_id}`} style={{ textDecoration: "none" }}>
                          <div style={{ fontSize: 14, fontWeight: 500, color: "var(--app-text)", marginBottom: 2 }}>
                            {row.generic_name}
                          </div>
                          {row.brand_names?.[0] && (
                            <div style={{ fontSize: 12, color: "var(--app-text-4)" }}>
                              {row.brand_names[0]}
                            </div>
                          )}
                        </Link>
                      </td>
                      <td style={{ padding: "12px 16px", whiteSpace: "nowrap" }}>
                        {severityBadge(row.severity)}
                      </td>
                      <td style={{ padding: "12px 16px" }}>
                        <span style={{ fontSize: 12, color: "var(--app-text-3)" }}>
                          {row.reason_category ?? "—"}
                        </span>
                      </td>
                      <td style={{ padding: "12px 16px", whiteSpace: "nowrap" }}>
                        <span style={{
                          display: "inline-block",
                          padding: "2px 7px", borderRadius: 5,
                          fontSize: 11, fontWeight: 600,
                          background: "var(--app-bg-2)",
                          color: "var(--app-text-3)",
                          letterSpacing: "0.04em",
                        }}>
                          {row.country_code}
                        </span>
                      </td>
                      <td style={{ padding: "12px 16px", fontSize: 12, color: "var(--app-text-4)", whiteSpace: "nowrap" }}>
                        {fmtDate(row.start_date)}
                      </td>
                      <td style={{ padding: "12px 16px", fontSize: 12, color: "var(--app-text-4)", whiteSpace: "nowrap" }}>
                        {fmtDate(row.estimated_resolution_date)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "14px 20px",
              borderTop: "1px solid var(--app-border)",
              background: "var(--app-bg)",
            }}>
              <span style={{ fontSize: 13, color: "var(--app-text-4)" }}>
                Page {page} of {totalPages} ({total.toLocaleString()} total)
              </span>
              <div style={{ display: "flex", gap: 8 }}>
                {page > 1 ? (
                  <Link href={buildUrl(sp, { page: String(page - 1) })} style={{
                    padding: "7px 14px", borderRadius: 7,
                    fontSize: 13, fontWeight: 500,
                    background: "var(--panel)", border: "1px solid var(--app-border)",
                    color: "var(--app-text-2)", textDecoration: "none",
                  }}>Previous</Link>
                ) : (
                  <span style={{
                    padding: "7px 14px", borderRadius: 7,
                    fontSize: 13, fontWeight: 500,
                    background: "var(--app-bg-2)", border: "1px solid var(--app-border)",
                    color: "var(--app-text-4)",
                  }}>Previous</span>
                )}
                {page < totalPages ? (
                  <Link href={buildUrl(sp, { page: String(page + 1) })} style={{
                    padding: "7px 14px", borderRadius: 7,
                    fontSize: 13, fontWeight: 500,
                    background: "var(--teal)", border: "1px solid var(--teal)",
                    color: "#fff", textDecoration: "none",
                  }}>Next</Link>
                ) : (
                  <span style={{
                    padding: "7px 14px", borderRadius: 7,
                    fontSize: 13, fontWeight: 500,
                    background: "var(--app-bg-2)", border: "1px solid var(--app-border)",
                    color: "var(--app-text-4)",
                  }}>Next</span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <style>{`
        .shortage-row:hover { background: var(--app-bg) !important; }
      `}</style>
    </div>
  );
}
