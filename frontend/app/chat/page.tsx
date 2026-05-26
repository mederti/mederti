"use client";

import { useState, useRef, useEffect, useCallback, useContext, createContext, type ReactNode, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowUp, X } from "lucide-react";
import SiteNav from "@/app/components/landing-nav";
import SiteFooter from "@/app/components/site-footer";
import { createBrowserClient } from "@/lib/supabase/client";
import { TopicalChip } from "./TopicalChip";

/* ── Drug panel context ────────────────────────────────────── */

const DrugPanelContext = createContext<{ openDrug: (id: string) => void }>({
  openDrug: () => {},
});

/* ── Types ─────────────────────────────────────────────────── */

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  drugs?: DrugHit[];
  shortages?: ShortageHit[];
  summary?: SummaryData | null;
  drugMap?: Record<string, string>;
}

interface DrugHit {
  drug_id: string;
  generic_name: string;
  brand_names: string[];
  atc_code: string | null;
  active_shortage_count: number;
}

interface ShortageHit {
  shortage_id: string;
  generic_name?: string;
  country_code: string;
  status: string;
  severity: string;
  reason_category?: string;
  start_date: string;
  source_name?: string;
}

interface SummaryData {
  total_active: number;
  by_severity: Record<string, number>;
  by_country: Array<{ country_code: string; count: number }>;
  new_this_month: number;
  resolved_this_month: number;
}

/* ── Markdown renderer ─────────────────────────────────────── */

function DrugLink({ name, drugId }: { name: string; drugId: string }) {
  const { openDrug } = useContext(DrugPanelContext);
  return (
    <button
      type="button"
      onClick={() => openDrug(drugId)}
      style={{
        background: "none",
        border: "none",
        padding: 0,
        margin: 0,
        font: "inherit",
        color: "inherit",
        cursor: "pointer",
        textDecoration: "underline",
        textDecorationColor: "var(--app-text-4)",
        textDecorationThickness: "1px",
        textUnderlineOffset: "3px",
        textDecorationStyle: "dotted",
        fontWeight: 600,
      }}
      className="chat-drug-link"
    >
      {name}
    </button>
  );
}

function lookupDrugId(name: string, drugMap?: Record<string, string>): string | null {
  if (!drugMap) return null;
  const direct = drugMap[name];
  if (direct) return direct;
  const lower = name.toLowerCase();
  for (const k of Object.keys(drugMap)) {
    if (k.toLowerCase() === lower) return drugMap[k];
  }
  return null;
}

function renderInline(
  text: string,
  keyPrefix: string,
  drugMap?: Record<string, string>
): ReactNode[] {
  const parts: ReactNode[] = [];
  const regex = /\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`/g;
  let last = 0;
  let match;
  let k = 0;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    if (match[1]) {
      const drugId = lookupDrugId(match[1], drugMap);
      if (drugId) {
        parts.push(<DrugLink key={`${keyPrefix}-${k++}`} name={match[1]} drugId={drugId} />);
      } else {
        parts.push(<strong key={`${keyPrefix}-${k++}`}>{match[1]}</strong>);
      }
    }
    else if (match[2]) parts.push(<em key={`${keyPrefix}-${k++}`}>{match[2]}</em>);
    else if (match[3]) parts.push(
      <code key={`${keyPrefix}-${k++}`} style={{
        padding: "1px 5px", borderRadius: 4, fontSize: "0.9em",
        background: "var(--app-bg)", fontFamily: "var(--font-dm-mono), monospace",
      }}>{match[3]}</code>
    );
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function parseTableBlock(
  lines: string[]
): { header: string[]; rows: string[][] } | null {
  const nonEmpty = lines.filter((l) => l.trim() !== "");
  if (nonEmpty.length < 2) return null;
  if (!nonEmpty.every((l) => l.includes("|"))) return null;
  if (!/^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/.test(nonEmpty[1])) return null;

  const splitRow = (row: string): string[] => {
    let r = row.trim();
    if (r.startsWith("|")) r = r.slice(1);
    if (r.endsWith("|")) r = r.slice(0, -1);
    return r.split("|").map((c) => c.trim());
  };

  const header = splitRow(nonEmpty[0]);
  const rows = nonEmpty.slice(2).map(splitRow);
  if (rows.length === 0) return null;
  return { header, rows };
}

function TableBlock({
  header,
  rows,
  blockIdx,
  drugMap,
}: {
  header: string[];
  rows: string[][];
  blockIdx: number;
  drugMap?: Record<string, string>;
}) {
  return (
    <div style={{ margin: "4px 0 18px", overflowX: "auto" }}>
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: 14,
          lineHeight: 1.55,
        }}
      >
        <thead>
          <tr>
            {header.map((h, ci) => (
              <th
                key={ci}
                style={{
                  textAlign: "left",
                  padding: "0 20px 10px 0",
                  fontWeight: 600,
                  color: "var(--app-text)",
                  borderBottom: "1px solid var(--app-border)",
                  verticalAlign: "top",
                }}
              >
                {renderInline(h, `t${blockIdx}-h${ci}`, drugMap)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>
              {row.map((cell, ci) => (
                <td
                  key={ci}
                  style={{
                    padding: "14px 20px 14px 0",
                    verticalAlign: "top",
                    borderBottom:
                      ri < rows.length - 1
                        ? "1px solid var(--app-border)"
                        : "none",
                    color: "var(--app-text)",
                  }}
                >
                  {renderInline(cell, `t${blockIdx}-r${ri}-c${ci}`, drugMap)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function renderMarkdown(text: string, drugMap?: Record<string, string>): ReactNode {
  if (!text) return null;
  const blocks = text.split(/\n\n+/);

  return blocks.map((block, bi) => {
    const lines = block.split("\n");

    const table = parseTableBlock(lines);
    if (table) {
      return (
        <TableBlock
          key={bi}
          header={table.header}
          rows={table.rows}
          blockIdx={bi}
          drugMap={drugMap}
        />
      );
    }

    const allBullets = lines.every((l) => /^\s*[-•]\s/.test(l) || l.trim() === "");
    if (allBullets && lines.some((l) => /^\s*[-•]\s/.test(l))) {
      return (
        <ul key={bi} style={{ margin: "0 0 16px", padding: 0, listStyle: "none" }}>
          {lines
            .filter((l) => /^\s*[-•]\s/.test(l))
            .map((l, li) => {
              const content = l.trimStart().replace(/^[-•]\s/, "");
              return (
                <li
                  key={li}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 10,
                    marginBottom: 6,
                    lineHeight: 1.65,
                  }}
                >
                  <span
                    aria-hidden
                    style={{
                      flexShrink: 0,
                      marginTop: 10,
                      width: 4,
                      height: 4,
                      borderRadius: 99,
                      background: "var(--app-text-4, #999)",
                    }}
                  />
                  <span style={{ flex: 1 }}>{renderInline(content, `${bi}-${li}`, drugMap)}</span>
                </li>
              );
            })}
        </ul>
      );
    }

    return (
      <div key={bi} style={{ margin: "0 0 16px", lineHeight: 1.7 }}>
        {lines.map((line, li) => (
          <div key={li}>{renderInline(line, `${bi}-${li}`, drugMap)}</div>
        ))}
      </div>
    );
  });
}

/* ── Severity badge ────────────────────────────────────────── */

function SeverityBadge({ severity }: { severity: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    critical: { bg: "var(--crit-bg)", color: "var(--crit)" },
    high: { bg: "var(--hi-bg)", color: "var(--hi)" },
    medium: { bg: "var(--med-bg)", color: "var(--med)" },
    low: { bg: "var(--low-bg)", color: "var(--low)" },
  };
  const s = map[severity?.toLowerCase()] ?? map.low;
  return (
    <span style={{
      fontSize: 10, fontWeight: 600, padding: "2px 7px", borderRadius: 4,
      background: s.bg, color: s.color, textTransform: "uppercase", letterSpacing: "0.04em",
    }}>
      {severity}
    </span>
  );
}

/* ── Drug pills ────────────────────────────────────────────── */

function DrugPills({ drugs }: { drugs: DrugHit[] }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "8px 0 4px" }}>
      {drugs.slice(0, 6).map((d) => (
        <Link
          key={d.drug_id}
          href={`/drugs/${d.drug_id}`}
          className="chat-drug-pill"
          style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "8px 16px", borderRadius: 99,
            background: "var(--app-bg-2, #f8fafc)",
            border: "1px solid var(--app-border)",
            textDecoration: "none", color: "var(--app-text)",
            fontSize: 13, fontWeight: 500,
            transition: "background 0.15s, border-color 0.15s",
          }}
        >
          {d.generic_name}
          {d.active_shortage_count > 0 && (
            <span style={{
              fontSize: 10, fontWeight: 600,
              padding: "1px 6px", borderRadius: 10,
              background: "var(--hi-bg)", color: "var(--hi)",
            }}>
              {d.active_shortage_count}
            </span>
          )}
        </Link>
      ))}
    </div>
  );
}

/* ── Shortage rows — no panel ─────────────────────────────── */

function ShortageTable({ shortages }: { shortages: ShortageHit[] }) {
  return (
    <div style={{ margin: "8px 0 4px" }}>
      {shortages.slice(0, 8).map((s, i) => (
        <div
          key={s.shortage_id}
          style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "8px 0",
            borderBottom: i < Math.min(shortages.length, 8) - 1 ? "1px solid var(--app-border)" : "none",
            fontSize: 13,
          }}
        >
          <span style={{
            fontWeight: 600, fontSize: 11, color: "var(--app-text-3)",
            fontFamily: "var(--font-dm-mono), monospace",
            minWidth: 24, letterSpacing: "0.02em",
          }}>
            {s.country_code}
          </span>
          {s.generic_name && (
            <span style={{ fontWeight: 500, color: "var(--app-text)" }}>{s.generic_name}</span>
          )}
          <SeverityBadge severity={s.severity} />
          <span style={{
            color: "var(--app-text-4)", marginLeft: "auto", fontSize: 12,
            fontFamily: "var(--font-dm-mono), monospace",
          }}>
            {s.start_date}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ── Summary stats — no panel ─────────────────────────────── */

function SummaryStats({ data }: { data: SummaryData }) {
  const items = [
    { value: data.total_active, label: "Active", color: "var(--app-text)" },
    { value: data.by_severity.critical ?? 0, label: "Critical", color: "var(--crit)" },
    { value: data.by_severity.high ?? 0, label: "High", color: "var(--hi)" },
    { value: data.new_this_month, label: "New this month", color: "var(--teal)" },
    { value: data.resolved_this_month, label: "Resolved", color: "var(--low)" },
  ];
  return (
    <div style={{
      display: "flex", gap: 24, flexWrap: "wrap",
      margin: "8px 0 4px",
    }}>
      {items.map((item) => (
        <div key={item.label}>
          <div style={{ fontSize: 22, fontWeight: 700, color: item.color, letterSpacing: "-0.02em" }}>
            {item.value.toLocaleString()}
          </div>
          <div style={{ fontSize: 11, color: "var(--app-text-4)", marginTop: 1 }}>{item.label}</div>
        </div>
      ))}
    </div>
  );
}

/* ── Suggested queries ─────────────────────────────────────── */

const SUGGESTED_QUERIES = [
  "What\u2019s the global shortage situation?",
  "Is amoxicillin available in Australia?",
  "Alternatives to metformin",
  "Critical shortages in the US",
  "Cisplatin recalls",
  "Which country has the most shortages?",
];

/* ── Drug preview panel (slide-in from right) ─────────────── */

interface DrugPreviewData {
  drug: {
    id: string;
    generic_name: string;
    brand_names: string[] | null;
    atc_code: string | null;
    atc_description: string | null;
    drug_class: string | null;
  };
  activeShortageCount: number;
  severityCount: Record<string, number>;
  countries: string[];
  recentShortages: Array<{
    shortage_id: string;
    country_code: string;
    severity: string | null;
    status: string;
    start_date: string | null;
    reason_category: string | null;
    source_name: string | null;
  }>;
  alternatives: Array<{
    alt_drug_id: string;
    alt_generic_name: string;
    similarity_score: number | null;
    evidence_grade: string | null;
  }>;
}

function DrugPreviewPanel({ drugId, onClose }: { drugId: string | null; onClose: () => void }) {
  const [data, setData] = useState<DrugPreviewData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!drugId) return;
    setData(null);
    setLoading(true);
    setError(null);
    let cancelled = false;
    fetch(`/api/drugs/${drugId}/preview`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j) => { if (!cancelled) setData(j); })
      .catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [drugId]);

  useEffect(() => {
    if (!drugId) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drugId, onClose]);

  const open = !!drugId;

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(15,23,42,0.18)",
          opacity: open ? 1 : 0,
          pointerEvents: open ? "auto" : "none",
          transition: "opacity 0.18s ease",
          zIndex: 90,
        }}
      />
      <aside
        role="dialog"
        aria-label="Drug preview"
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: "min(480px, 100vw)",
          background: "var(--app-bg)",
          borderLeft: "1px solid var(--app-border)",
          boxShadow: open ? "-12px 0 32px rgba(15,23,42,0.08)" : "none",
          transform: open ? "translateX(0)" : "translateX(100%)",
          transition: "transform 0.22s ease",
          zIndex: 100,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <header
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 12,
            padding: "18px 20px 14px",
            borderBottom: "1px solid var(--app-border)",
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            {data ? (
              <>
                <div style={{ fontSize: 17, fontWeight: 600, color: "var(--app-text)", letterSpacing: "-0.01em", marginBottom: 4 }}>
                  {data.drug.generic_name}
                </div>
                {data.drug.brand_names && data.drug.brand_names.length > 0 && (
                  <div style={{ fontSize: 12, color: "var(--app-text-4)" }}>
                    {data.drug.brand_names.slice(0, 4).join(" · ")}
                    {data.drug.brand_names.length > 4 && ` +${data.drug.brand_names.length - 4}`}
                  </div>
                )}
              </>
            ) : (
              <div style={{ fontSize: 14, color: "var(--app-text-4)" }}>
                {loading ? "Loading…" : error ? "Failed to load" : ""}
              </div>
            )}
          </div>
          {data?.drug.atc_code && (
            <span style={{
              fontSize: 11, fontWeight: 600, color: "var(--teal)", background: "var(--teal-bg)",
              padding: "4px 8px", borderRadius: 4, fontFamily: "var(--font-dm-mono), monospace",
              flexShrink: 0,
            }}>
              {data.drug.atc_code}
            </span>
          )}
          <button
            onClick={onClose}
            aria-label="Close preview"
            style={{
              background: "none", border: "none", padding: 4, cursor: "pointer",
              color: "var(--app-text-3)", flexShrink: 0, borderRadius: 4,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            <X size={18} />
          </button>
        </header>

        <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px 24px" }}>
          {data && (
            <>
              <section style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--app-text-3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
                  Current supply
                </div>
                {data.activeShortageCount > 0 ? (
                  <>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6 }}>
                      <span style={{ fontSize: 24, fontWeight: 600, color: "var(--app-text)" }}>
                        {data.activeShortageCount}
                      </span>
                      <span style={{ fontSize: 13, color: "var(--app-text-3)" }}>
                        active shortage{data.activeShortageCount !== 1 ? "s" : ""}
                        {data.countries.length > 0 && ` across ${data.countries.length} countr${data.countries.length === 1 ? "y" : "ies"}`}
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {(["critical", "high", "medium", "low"] as const).map((sev) => {
                        const n = data.severityCount[sev] ?? 0;
                        if (n === 0) return null;
                        return <SeverityBadge key={sev} severity={sev} />;
                      })}
                    </div>
                  </>
                ) : (
                  <div style={{ fontSize: 13, color: "var(--low)", fontWeight: 500 }}>
                    No active shortages reported.
                  </div>
                )}
              </section>

              {data.recentShortages.length > 0 && (
                <section style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "var(--app-text-3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
                    Recent events
                  </div>
                  <div>
                    {data.recentShortages.map((s, i) => (
                      <div
                        key={s.shortage_id}
                        style={{
                          display: "flex", alignItems: "center", gap: 10,
                          padding: "8px 0",
                          borderBottom: i < data.recentShortages.length - 1 ? "1px solid var(--app-border)" : "none",
                          fontSize: 13,
                        }}
                      >
                        <span style={{
                          fontWeight: 600, fontSize: 11, color: "var(--app-text-3)",
                          fontFamily: "var(--font-dm-mono), monospace",
                          minWidth: 24, letterSpacing: "0.02em",
                        }}>
                          {s.country_code}
                        </span>
                        {s.severity && <SeverityBadge severity={s.severity} />}
                        <span style={{ color: "var(--app-text-3)", fontSize: 12, flex: 1 }}>
                          {s.reason_category ?? s.source_name ?? s.status}
                        </span>
                        {s.start_date && (
                          <span style={{
                            color: "var(--app-text-4)", fontSize: 12,
                            fontFamily: "var(--font-dm-mono), monospace",
                          }}>
                            {s.start_date}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {data.alternatives.length > 0 && (
                <section style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "var(--app-text-3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
                    Therapeutic alternatives
                  </div>
                  <div>
                    {data.alternatives.map((a) => (
                      <Link
                        key={a.alt_drug_id}
                        href={`/drugs/${a.alt_drug_id}`}
                        style={{
                          display: "flex", alignItems: "center", gap: 10,
                          padding: "8px 0",
                          textDecoration: "none", color: "var(--app-text)",
                          fontSize: 13,
                        }}
                      >
                        <span style={{ fontWeight: 500, flex: 1 }}>{a.alt_generic_name}</span>
                        {a.evidence_grade && (
                          <span style={{
                            fontSize: 10, fontWeight: 600,
                            padding: "2px 6px", borderRadius: 3,
                            background: "var(--app-bg-2, #f8fafc)",
                            color: "var(--app-text-3)",
                            fontFamily: "var(--font-dm-mono), monospace",
                            letterSpacing: "0.04em",
                          }}>
                            {a.evidence_grade}
                          </span>
                        )}
                        {a.similarity_score != null && (
                          <span style={{
                            fontSize: 11, color: "var(--app-text-4)",
                            fontFamily: "var(--font-dm-mono), monospace",
                          }}>
                            {Math.round(a.similarity_score * 100)}%
                          </span>
                        )}
                      </Link>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
          {!data && loading && (
            <div style={{ fontSize: 13, color: "var(--app-text-4)" }}>Loading drug preview…</div>
          )}
          {!data && error && (
            <div style={{ fontSize: 13, color: "var(--crit)" }}>Could not load preview ({error}).</div>
          )}
        </div>

        {drugId && (
          <footer
            style={{
              padding: "12px 20px",
              borderTop: "1px solid var(--app-border)",
              background: "var(--app-bg)",
            }}
          >
            <Link
              href={`/drugs/${drugId}`}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                fontSize: 13, fontWeight: 500,
                color: "var(--teal)", textDecoration: "none",
              }}
            >
              View full profile →
            </Link>
          </footer>
        )}
      </aside>
    </>
  );
}

/* ── Thinking indicator ────────────────────────────────────── */

function ThinkingIndicator() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0" }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/favicon.ico" alt="" width={20} height={20} style={{ borderRadius: 5, flexShrink: 0 }} />
      <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
        <span className="chat-dot" style={{ animationDelay: "0s" }} />
        <span className="chat-dot" style={{ animationDelay: "0.15s" }} />
        <span className="chat-dot" style={{ animationDelay: "0.3s" }} />
      </span>
    </div>
  );
}

/* ── Main chat page ────────────────────────────────────────── */

function ChatPageInner() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [isAuthed, setIsAuthed] = useState(false);
  const [previewDrugId, setPreviewDrugId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  const openDrug = useCallback((id: string) => setPreviewDrugId(id), []);
  const closeDrug = useCallback(() => setPreviewDrugId(null), []);

  useEffect(() => {
    createBrowserClient().auth.getSession().then(({ data: { session } }) => {
      setIsAuthed(!!session);
      setAuthChecked(true);
    });
  }, []);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    if (messages.length > 0) scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
      inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 160) + "px";
    }
  }, [input]);

  useEffect(() => { inputRef.current?.focus(); }, []);

  // Handle ?q= param — pre-fill and auto-send
  const searchParams = useSearchParams();
  const preloadedRef = useRef(false);
  useEffect(() => {
    const q = searchParams.get("q");
    if (q && !preloadedRef.current && messages.length === 0) {
      preloadedRef.current = true;
      // Small delay so component is fully mounted
      setTimeout(() => sendMessage(decodeURIComponent(q)), 100);
    }
  }, [searchParams, messages.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || streaming) return;

    const userMsg: ChatMessage = { role: "user", content: text.trim() };
    const allMessages = [...messages, userMsg];
    setMessages(allMessages);
    setInput("");
    setStreaming(true);

    if (inputRef.current) inputRef.current.style.height = "auto";

    // Read the user's country from the nav cookie
    const countryMatch = document.cookie.match(/(?:^|; )mederti-country=([A-Z]{2})/);
    const userCountry = countryMatch?.[1] ?? "AU";

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: allMessages.map((m) => ({ role: m.role, content: m.content })),
          userCountry,
        }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (!res.body) throw new Error("No stream");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let assistantContent = "";
      let assistantDrugs: DrugHit[] = [];
      let assistantShortages: ShortageHit[] = [];
      let assistantSummary: SummaryData | null = null;
      let buffer = "";

      setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const payload = JSON.parse(line.slice(6));
            if (payload.type === "text" && payload.content) {
              assistantContent += payload.content;
            } else if (payload.type === "drugs" && payload.data) {
              assistantDrugs = [...assistantDrugs, ...payload.data];
            } else if (payload.type === "shortages" && payload.data) {
              assistantShortages = [...assistantShortages, ...payload.data];
            } else if (payload.type === "summary" && payload.data) {
              assistantSummary = payload.data;
            } else if (payload.type === "done") {
              break;
            }

            setMessages((prev) => {
              const updated = [...prev];
              updated[updated.length - 1] = {
                role: "assistant",
                content: assistantContent,
                drugs: assistantDrugs.length > 0 ? assistantDrugs : undefined,
                shortages: assistantShortages.length > 0 ? assistantShortages : undefined,
                summary: assistantSummary,
              };
              return updated;
            });
          } catch {
            // ignore parse errors
          }
        }
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Unknown error";
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Something went wrong: ${errMsg}. Please try again.` },
      ]);
    } finally {
      setStreaming(false);
      inputRef.current?.focus();

      // Resolve all bolded names in the assistant response to drug_ids for
      // inline linking. Seed with the drugs the chat already tool-searched.
      const seedMap: Record<string, string> = {};
      for (const d of assistantDrugs) {
        if (d.generic_name && d.drug_id) seedMap[d.generic_name] = d.drug_id;
      }
      const boldMatches = [...assistantContent.matchAll(/\*\*([^*\n]{2,80})\*\*/g)].map((m) => m[1].trim());
      const uniqueNames = [...new Set(boldMatches)].filter((n) => n && !seedMap[n]);

      const finalize = (lookupMap: Record<string, string>) => {
        const merged = { ...seedMap, ...lookupMap };
        setMessages((prev) => {
          if (prev.length === 0) return prev;
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last.role === "assistant") {
            updated[updated.length - 1] = { ...last, drugMap: merged };
          }
          return updated;
        });
      };

      if (uniqueNames.length === 0) {
        finalize({});
      } else {
        try {
          const r = await fetch("/api/bulk-lookup", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ drugNames: uniqueNames }),
          });
          if (r.ok) {
            const j = await r.json();
            const map: Record<string, string> = {};
            for (const row of (j.results ?? []) as Array<{ drugName: string; matchedDrug: { drug_id: string } | null; matchConfidence: string }>) {
              if (row.matchedDrug && row.matchConfidence !== "none") {
                map[row.drugName] = row.matchedDrug.drug_id;
              }
            }
            finalize(map);
          } else {
            finalize({});
          }
        } catch {
          finalize({});
        }
      }
    }
  }, [messages, streaming]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const isEmpty = messages.length === 0;

  if (authChecked && !isAuthed) {
    return (
      <div style={{
        display: "flex", flexDirection: "column",
        minHeight: "100vh", background: "var(--app-bg)",
        color: "var(--app-text)",
      }}>
        <SiteNav />
        <div style={{
          flex: 1, display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center",
          gap: 16, textAlign: "center", padding: 24,
        }}>
          <div style={{ marginBottom: 4, display: "flex", justifyContent: "center" }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#1a1a1a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>
          <div style={{ fontSize: 20, fontWeight: 600 }}>Sign in to use Mederti Intelligence</div>
          <div style={{ fontSize: 14, color: "var(--app-text-3)", maxWidth: 340, lineHeight: 1.6 }}>
            Get full access to AI-powered drug shortage intelligence, forecasting, and supplier connections.
          </div>
          <Link href="/login?next=/chat" style={{
            padding: "12px 24px", borderRadius: 10,
            background: "var(--teal)", color: "#fff",
            fontSize: 14, fontWeight: 500, textDecoration: "none",
          }}>
            Sign in
          </Link>
          <Link href="/signup" style={{ fontSize: 13, color: "var(--teal)", textDecoration: "none" }}>
            Create free account
          </Link>
        </div>
        <SiteFooter />
      </div>
    );
  }

  return (
    <DrugPanelContext.Provider value={{ openDrug }}>
      <DrugPreviewPanel drugId={previewDrugId} onClose={closeDrug} />
    <div style={{
      display: "flex", flexDirection: "column",
      height: "100vh", background: "var(--app-bg)",
      color: "var(--app-text)",
    }}>
      <SiteNav />

      {/* Scrollable area */}
      <div
        ref={scrollAreaRef}
        style={{
          flex: 1, overflowY: "auto",
          display: "flex", flexDirection: "column",
        }}
      >
        <div style={{
          flex: 1, display: "flex", flexDirection: "column",
          maxWidth: 720, width: "100%", margin: "0 auto",
          padding: "0 24px",
        }}>

          {/* ── Empty state ── */}
          {isEmpty && (
            <div style={{
              flex: 1, display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center",
              paddingBottom: 80,
            }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/favicon.ico"
                alt="Mederti"
                width={40}
                height={40}
                style={{ borderRadius: 10, marginBottom: 24 }}
              />

              <h1 style={{
                fontSize: 28, fontWeight: 700,
                color: "var(--app-text)", margin: "0 0 10px",
                letterSpacing: "-0.02em",
              }}>
                Find Short-Supply Drugs Globally
              </h1>

              <p style={{
                fontSize: 15, color: "var(--app-text-4)",
                margin: "0 0 36px", textAlign: "center", maxWidth: 400,
                lineHeight: 1.6,
              }}>
                Ask about drug shortages, alternatives, recalls, or supply intelligence across 30+ countries.
              </p>

              {/* Suggestion chips — horizontal wrap, white pill style */}
              <div style={{
                display: "flex", flexWrap: "wrap", justifyContent: "center",
                gap: 8,
                width: "100%", maxWidth: 640,
              }}>
                <TopicalChip onSelect={sendMessage} />
                {SUGGESTED_QUERIES.map((q) => (
                  <button
                    key={q}
                    onClick={() => sendMessage(q)}
                    className="chat-chip"
                    style={{
                      padding: "10px 20px", borderRadius: 99,
                      background: "#fff",
                      border: "1px solid var(--app-border)",
                      fontSize: 13, color: "var(--app-text-3)",
                      cursor: "pointer", textAlign: "center",
                      fontFamily: "var(--font-inter), sans-serif",
                      transition: "background 0.15s, border-color 0.15s, color 0.15s",
                      lineHeight: 1.4,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── Conversation ── */}
          {!isEmpty && (
            <div style={{ paddingTop: 32, paddingBottom: 16 }}>
              {messages.map((msg, i) => (
                <div key={i} style={{ marginBottom: 28 }}>
                  {msg.role === "user" ? (
                    /* ── User turn ── */
                    <div style={{
                      display: "flex", justifyContent: "flex-end",
                    }}>
                      <div style={{
                        maxWidth: "80%",
                        padding: "12px 18px",
                        borderRadius: 20,
                        background: "var(--app-bg-2, #f0f0f0)",
                        fontSize: 15, lineHeight: 1.6,
                        color: "var(--app-text)",
                      }}>
                        {msg.content}
                      </div>
                    </div>
                  ) : (
                    /* ── Assistant turn — no panels, just flowing content ── */
                    <div>
                      {/* Avatar */}
                      <div style={{ marginBottom: 6 }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src="/favicon.ico"
                          alt="Mederti"
                          width={20}
                          height={20}
                          style={{ borderRadius: 5 }}
                        />
                      </div>

                      {/* Structured data — inline, no cards/panels */}
                      {msg.summary && <SummaryStats data={msg.summary} />}
                      {msg.drugs && msg.drugs.length > 0 && <DrugPills drugs={msg.drugs} />}
                      {msg.shortages && msg.shortages.length > 0 && <ShortageTable shortages={msg.shortages} />}

                      {/* Text — flows naturally */}
                      {msg.content ? (
                        <div style={{
                          fontSize: 15, lineHeight: 1.7,
                          color: "var(--app-text-2)",
                          marginTop: (msg.drugs || msg.shortages || msg.summary) ? 12 : 0,
                        }}>
                          {renderMarkdown(msg.content, msg.drugMap)}
                        </div>
                      ) : (
                        streaming && i === messages.length - 1 && (
                          <ThinkingIndicator />
                        )
                      )}
                    </div>
                  )}
                </div>
              ))}
              <div ref={bottomRef} />
            </div>
          )}
        </div>
      </div>

      {/* ── Input bar ── */}
      <div style={{
        borderTop: "1px solid var(--app-border)",
        background: "var(--app-bg)",
        padding: "16px 24px 20px",
      }}>
        <div style={{ maxWidth: 720, margin: "0 auto" }}>
          <form
            onSubmit={handleSubmit}
            className="chat-input-form"
            style={{
              display: "flex", alignItems: "flex-end", gap: 10,
              background: "var(--app-bg)",
              border: "1px solid var(--app-border)",
              borderRadius: 24,
              padding: "12px 14px 12px 20px",
              transition: "border-color 0.2s, box-shadow 0.2s",
            }}
          >
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask anything about drug shortages..."
              disabled={streaming}
              rows={1}
              style={{
                flex: 1, resize: "none",
                border: "none", outline: "none",
                fontSize: 15, lineHeight: 1.5,
                fontFamily: "var(--font-inter), sans-serif",
                color: "var(--app-text)",
                background: "transparent",
                padding: "4px 0",
                maxHeight: 160,
              }}
            />
            <button
              type="submit"
              disabled={streaming || !input.trim()}
              className="chat-send-btn"
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: 32, height: 32, borderRadius: "50%",
                background: streaming || !input.trim() ? "var(--app-border)" : "var(--teal)",
                color: "#fff", border: "none",
                cursor: streaming || !input.trim() ? "default" : "pointer",
                flexShrink: 0,
                transition: "background 0.15s",
              }}
              aria-label="Send message"
            >
              <ArrowUp style={{ width: 16, height: 16 }} strokeWidth={2.5} />
            </button>
          </form>

          <div style={{
            fontSize: 11, color: "var(--app-text-4)",
            textAlign: "center", marginTop: 8,
            letterSpacing: "0.01em",
          }}>
            AI-powered &middot; 30+ regulatory sources &middot; Not medical advice
          </div>
        </div>
      </div>

      <style>{`
        @keyframes chatBlink {
          0%, 80%, 100% { opacity: 0.2; }
          40% { opacity: 0.8; }
        }
        .chat-dot {
          width: 5px; height: 5px; border-radius: 50%;
          background: var(--app-text-4);
          animation: chatBlink 1.2s ease-in-out infinite;
        }
        .chat-chip:hover {
          border-color: var(--teal-b) !important;
          color: var(--teal) !important;
          background: var(--teal-bg) !important;
        }
        .chat-drug-pill:hover {
          background: var(--teal-bg) !important;
        }
        .chat-input-form:focus-within {
          border-color: var(--teal-b) !important;
          box-shadow: 0 0 0 3px rgba(15,23,42,0.08) !important;
        }
        @media (max-width: 640px) {
          .chat-chip { font-size: 12px !important; padding: 10px 14px !important; }
        }
        .chat-drug-link:hover {
          color: var(--teal) !important;
          text-decoration-color: var(--teal) !important;
        }
      `}</style>
    </div>
    </DrugPanelContext.Provider>
  );
}

export default function ChatPage() {
  return (
    <Suspense>
      <ChatPageInner />
    </Suspense>
  );
}
