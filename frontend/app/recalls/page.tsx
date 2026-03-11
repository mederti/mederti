import Link from "next/link";
import { PackageX } from "lucide-react";
import { api, RecallListResponse } from "@/lib/api";
import SiteNav from "@/app/components/landing-nav";

interface SearchParams {
  country_code?: string;
  recall_class?: string;
  status?: string;
  page?: string;
}

interface Props {
  searchParams: Promise<SearchParams>;
}

type RecallClassKey = "I" | "II" | "III";

const CLASS_STYLES: Record<RecallClassKey, { label: string; color: string; bg: string; border: string }> = {
  I:   { label: "Class I",   color: "var(--crit)", bg: "var(--crit-bg)", border: "var(--crit-b)" },
  II:  { label: "Class II",  color: "var(--high)", bg: "var(--high-bg)", border: "var(--high-b)" },
  III: { label: "Class III", color: "var(--med)",  bg: "var(--med-bg)",  border: "var(--med-b)"  },
};

function ClassBadge({ recallClass }: { recallClass: string | null }) {
  const key = (recallClass ?? "").replace("Class ", "") as RecallClassKey;
  const style = CLASS_STYLES[key];
  if (!style) {
    return (
      <span style={{
        display: "inline-block", padding: "2px 9px", borderRadius: 6,
        fontSize: 11, fontWeight: 600,
        background: "var(--app-bg-2)", color: "var(--app-text-4)",
        border: "1px solid var(--app-border)",
      }}>
        {recallClass ?? "Unknown"}
      </span>
    );
  }
  return (
    <span style={{
      display: "inline-block", padding: "2px 9px", borderRadius: 6,
      fontSize: 11, fontWeight: 600,
      background: style.bg, color: style.color,
      border: `1px solid ${style.border}`,
    }}>
      {style.label}
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
  if (merged.country_code) params.set("country_code", merged.country_code);
  if (merged.recall_class) params.set("recall_class",  merged.recall_class);
  if (merged.status)       params.set("status",        merged.status);
  if (merged.page)         params.set("page",          merged.page);
  const qs = params.toString();
  return `/recalls${qs ? "?" + qs : ""}`;
}

const COUNTRIES  = ["US", "AU", "CA", "GB", "EU", "DE", "FR"];
const CLASSES    = ["I", "II", "III"] as const;
const STATUSES   = ["active", "completed"] as const;

export default async function RecallsPage({ searchParams }: Props) {
  const sp = await searchParams;
  const page       = Math.max(1, parseInt(sp.page ?? "1", 10));
  const pageSize   = 20;

  const fetchParams: Record<string, string | number> = {
    page,
    page_size: pageSize,
  };
  if (sp.country_code) fetchParams.country_code = sp.country_code;
  if (sp.recall_class) fetchParams.recall_class  = sp.recall_class;
  if (sp.status)       fetchParams.status        = sp.status;

  let data: RecallListResponse | null = null;
  try {
    data = await api.getRecalls(fetchParams);
  } catch {
    // handled below
  }

  const results    = data?.results ?? [];
  const total      = data?.total   ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div style={{ background: "var(--app-bg)", minHeight: "100vh", color: "var(--app-text)" }}>

      {/* Hero */}
      <div style={{ background: "var(--navy)" }}>
        <SiteNav />
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "32px 24px 28px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <PackageX style={{ width: 20, height: 20, color: "var(--teal-l)" }} strokeWidth={1.8} />
            <h1 style={{ fontSize: 22, fontWeight: 700, color: "#fff", margin: 0 }}>Drug Recalls</h1>
          </div>
          <p style={{ fontSize: 14, color: "rgba(255,255,255,0.55)", margin: 0 }}>
            {total.toLocaleString()} recall{total !== 1 ? "s" : ""} tracked across global regulators
          </p>
        </div>
      </div>

      {/* Filter chips */}
      <div style={{ background: "var(--navy-2)", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "12px 24px", display: "flex", gap: 20, flexWrap: "wrap", alignItems: "center" }}>

          {/* Country */}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.06em" }}>Country</span>
            <Link href={buildUrl(sp, { country_code: undefined, page: "1" })} style={{
              padding: "4px 10px", borderRadius: 20, fontSize: 12, textDecoration: "none", fontWeight: 500,
              background: !sp.country_code ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.04)",
              color: !sp.country_code ? "#fff" : "rgba(255,255,255,0.5)",
              border: "1px solid rgba(255,255,255,0.1)",
            }}>All</Link>
            {COUNTRIES.map(c => (
              <Link key={c} href={buildUrl(sp, { country_code: c, page: "1" })} style={{
                padding: "4px 10px", borderRadius: 20, fontSize: 12, textDecoration: "none", fontWeight: 500,
                background: sp.country_code === c ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.04)",
                color: sp.country_code === c ? "#fff" : "rgba(255,255,255,0.5)",
                border: "1px solid rgba(255,255,255,0.1)",
              }}>{c}</Link>
            ))}
          </div>

          {/* Class */}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.06em" }}>Class</span>
            <Link href={buildUrl(sp, { recall_class: undefined, page: "1" })} style={{
              padding: "4px 10px", borderRadius: 20, fontSize: 12, textDecoration: "none", fontWeight: 500,
              background: !sp.recall_class ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.04)",
              color: !sp.recall_class ? "#fff" : "rgba(255,255,255,0.5)",
              border: "1px solid rgba(255,255,255,0.1)",
            }}>All</Link>
            {CLASSES.map(cls => {
              const active = sp.recall_class === cls;
              const style = CLASS_STYLES[cls];
              return (
                <Link key={cls} href={buildUrl(sp, { recall_class: cls, page: "1" })} style={{
                  padding: "4px 10px", borderRadius: 20, fontSize: 12, textDecoration: "none", fontWeight: 500,
                  background: active ? style.bg : "rgba(255,255,255,0.04)",
                  color: active ? style.color : "rgba(255,255,255,0.5)",
                  border: `1px solid ${active ? style.border : "rgba(255,255,255,0.1)"}`,
                }}>Class {cls}</Link>
              );
            })}
          </div>

          {/* Status */}
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
            <div style={{ padding: "64px 24px", textAlign: "center" }}>
              <PackageX style={{ width: 36, height: 36, color: "var(--app-text-4)", margin: "0 auto 12px", display: "block" }} strokeWidth={1.5} />
              <p style={{ fontSize: 15, fontWeight: 500, color: "var(--app-text-2)", marginBottom: 6 }}>No recalls found</p>
              <p style={{ fontSize: 13, color: "var(--app-text-4)" }}>Try adjusting the filters above.</p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column" }}>
              {/* Header row */}
              <div style={{
                display: "grid",
                gridTemplateColumns: "1fr auto auto auto auto",
                gap: 16,
                padding: "10px 20px",
                background: "var(--app-bg)",
                borderBottom: "1px solid var(--app-border)",
              }}>
                {["Drug / Manufacturer", "Class", "Country", "Announced", "Status"].map(col => (
                  <span key={col} style={{
                    fontSize: 11, fontWeight: 600, color: "var(--app-text-4)",
                    textTransform: "uppercase", letterSpacing: "0.05em",
                  }}>
                    {col}
                  </span>
                ))}
              </div>

              {results.map((row, i) => {
                const href = row.drug_id
                  ? `/drugs/${row.drug_id}`
                  : row.press_release_url ?? "#";
                const isExternal = !row.drug_id && !!row.press_release_url;

                return (
                  <div
                    key={row.id}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr auto auto auto auto",
                      gap: 16,
                      padding: "14px 20px",
                      alignItems: "center",
                      borderBottom: i < results.length - 1 ? "1px solid var(--app-border)" : "none",
                      transition: "background 0.1s",
                    }}
                    className="recall-row"
                  >
                    {/* Drug / Manufacturer */}
                    <div>
                      <Link
                        href={href}
                        target={isExternal ? "_blank" : undefined}
                        rel={isExternal ? "noopener noreferrer" : undefined}
                        style={{ textDecoration: "none" }}
                      >
                        <div style={{ fontSize: 14, fontWeight: 500, color: "var(--app-text)", marginBottom: 2 }}>
                          {row.generic_name}
                          {row.brand_name && (
                            <span style={{ fontSize: 12, fontWeight: 400, color: "var(--app-text-4)", marginLeft: 6 }}>
                              ({row.brand_name})
                            </span>
                          )}
                        </div>
                        {row.manufacturer && (
                          <div style={{ fontSize: 12, color: "var(--app-text-4)" }}>
                            {row.manufacturer}
                          </div>
                        )}
                      </Link>
                    </div>

                    {/* Class badge */}
                    <div><ClassBadge recallClass={row.recall_class} /></div>

                    {/* Country */}
                    <div>
                      <span style={{
                        display: "inline-block",
                        padding: "2px 7px", borderRadius: 5,
                        fontSize: 11, fontWeight: 600,
                        background: "var(--app-bg-2)", color: "var(--app-text-3)",
                        letterSpacing: "0.04em",
                      }}>
                        {row.country_code}
                      </span>
                    </div>

                    {/* Announced date */}
                    <div style={{ fontSize: 12, color: "var(--app-text-4)", whiteSpace: "nowrap" }}>
                      {fmtDate(row.announced_date)}
                    </div>

                    {/* Status */}
                    <div>
                      <span style={{
                        display: "inline-block",
                        padding: "2px 9px", borderRadius: 20,
                        fontSize: 11, fontWeight: 500,
                        textTransform: "capitalize",
                        background: row.status === "active" ? "var(--crit-bg)" : "var(--low-bg)",
                        color: row.status === "active" ? "var(--crit)" : "var(--low)",
                        border: `1px solid ${row.status === "active" ? "var(--crit-b)" : "var(--low-b)"}`,
                      }}>
                        {row.status}
                      </span>
                    </div>
                  </div>
                );
              })}
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
        .recall-row:hover { background: var(--app-bg) !important; }
      `}</style>
    </div>
  );
}
