"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Shield, LogIn, RefreshCw, AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import { createBrowserClient } from "@/lib/supabase/client";
import SiteNav from "@/app/components/landing-nav";
import SiteFooter from "@/app/components/site-footer";

interface SourceFreshness {
  abbreviation: string;
  country_code: string;
  region: string | null;
  scrape_frequency_hours: number;
  last_scraped_at: string | null;
  hours_since_scrape: number | null;
  status: "ok" | "stale" | "never";
  last_error?: { error: string; at: string } | null;
}

type Severity = "ok" | "info" | "warn" | "error";

interface HealthFinding {
  detector: string;
  severity: Severity;
  headline: string;
  detail?: string;
  metrics?: Record<string, unknown>;
  samples?: unknown[];
}

interface ScenarioResult {
  id: string;
  title: string | null;
  status: string;
  passed: number | null;
  failed: number | null;
  failures: string[];
}

interface HealthRun {
  id: string;
  run_at: string;
  runner: string;
  overall: "ok" | "warn" | "error";
  errors: number;
  warnings: number;
  findings?: HealthFinding[];
  scenarios?: { date?: string; base?: string; results?: ScenarioResult[] } | null;
  duration_s?: number | null;
}

interface FreshnessResponse {
  generated_at: string;
  summary: {
    active_sources: number;
    ok: number;
    stale: number;
    never_scraped: number;
    polluted_drug_count: number | null;
    recent_shortages_48h: number;
  };
  sources: SourceFreshness[];
  health?: { available: boolean; latest: HealthRun | null; history: HealthRun[] };
}

const SEV_COLOR: Record<Severity, { fg: string; bg: string; label: string }> = {
  ok:    { fg: "#0fa676", bg: "#e8f6f0", label: "ok" },
  info:  { fg: "#475569", bg: "#f1f5f9", label: "info" },
  warn:  { fg: "#b45309", bg: "#fef3c7", label: "warn" },
  error: { fg: "#dc2626", bg: "#fee2e2", label: "error" },
};

const STATUS_COLOR: Record<SourceFreshness["status"], { fg: string; bg: string; label: string }> = {
  ok:    { fg: "#0fa676", bg: "#e8f6f0", label: "ok" },
  stale: { fg: "#dc2626", bg: "#fee2e2", label: "stale" },
  never: { fg: "#b45309", bg: "#fef3c7", label: "never" },
};

const formatHours = (h: number | null): string => {
  if (h === null) return "—";
  if (h < 48) return `${h.toFixed(1)}h`;
  return `${(h / 24).toFixed(1)}d`;
};

export default function AdminFreshnessPage() {
  const supabase = createBrowserClient();
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [data, setData] = useState<FreshnessResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setAuthed(!!user);
    });
  }, [supabase]);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/freshness", { cache: "no-store" });
      if (res.status === 403) {
        setError("Forbidden — admin role required.");
        setData(null);
      } else if (!res.ok) {
        setError(`HTTP ${res.status}`);
      } else {
        const json = (await res.json()) as FreshnessResponse;
        setData(json);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (authed) void load();
  }, [authed]);

  if (authed === false) {
    return (
      <main style={{ minHeight: "100vh" }}>
        <SiteNav />
        <div style={{ maxWidth: 480, margin: "120px auto", textAlign: "center", padding: "0 20px" }}>
          <Shield size={32} style={{ color: "var(--teal)", margin: "0 auto 16px" }} />
          <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>Admin sign-in required</h1>
          <Link
            href="/login?redirect=/admin/freshness"
            style={{
              display: "inline-flex",
              gap: 8,
              alignItems: "center",
              padding: "10px 20px",
              background: "var(--teal)",
              color: "#fff",
              borderRadius: 8,
              textDecoration: "none",
              fontWeight: 600,
            }}
          >
            <LogIn size={16} /> Sign in
          </Link>
        </div>
        <SiteFooter />
      </main>
    );
  }

  return (
    <main style={{ minHeight: "100vh" }}>
      <SiteNav />
      <div style={{ maxWidth: 1100, margin: "40px auto 80px", padding: "0 24px" }}>
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 28,
          }}
        >
          <div>
            <h1 style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em", margin: 0 }}>
              Data freshness
            </h1>
            <p style={{ fontSize: 14, color: "#64748b", margin: "6px 0 0" }}>
              Per-source scrape recency and catalogue health.
            </p>
          </div>
          <button
            onClick={load}
            disabled={loading}
            style={{
              display: "inline-flex",
              gap: 6,
              alignItems: "center",
              padding: "8px 14px",
              background: "#fff",
              color: "#0f172a",
              border: "1px solid #e2e8f0",
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              cursor: loading ? "wait" : "pointer",
            }}
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
        </header>

        {error && (
          <div
            style={{
              padding: "12px 16px",
              background: "#fef2f2",
              border: "1px solid #fecaca",
              borderRadius: 8,
              color: "#dc2626",
              fontSize: 14,
              marginBottom: 20,
            }}
          >
            {error}
          </div>
        )}

        {data && (
          <>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
                gap: 12,
                marginBottom: 28,
              }}
            >
              <SummaryCard label="Active sources"   value={data.summary.active_sources} />
              <SummaryCard label="Healthy"          value={data.summary.ok}                color="#0fa676" />
              <SummaryCard
                label="Stale"
                value={data.summary.stale}
                color={data.summary.stale > 0 ? "#dc2626" : undefined}
                icon={data.summary.stale > 0 ? <AlertTriangle size={14} /> : undefined}
              />
              <SummaryCard
                label="Never scraped"
                value={data.summary.never_scraped}
                color={data.summary.never_scraped > 0 ? "#b45309" : undefined}
              />
              <SummaryCard
                label="Polluted drug rows"
                value={data.summary.polluted_drug_count ?? "?"}
                color={
                  (data.summary.polluted_drug_count ?? 0) > 0 ? "#dc2626" : undefined
                }
              />
              <SummaryCard
                label="Shortages verified (48h)"
                value={data.summary.recent_shortages_48h.toLocaleString()}
              />
            </div>

            <HealthPanel health={data.health} generatedAt={data.generated_at} />

            <div
              style={{
                background: "#fff",
                border: "1px solid #e2e8f0",
                borderRadius: 12,
                overflow: "hidden",
              }}
            >
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                    <Th>Source</Th>
                    <Th>Country</Th>
                    <Th>Region</Th>
                    <Th align="right">Cadence</Th>
                    <Th align="right">Last scrape</Th>
                    <Th align="right">Status</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.sources
                    .slice()
                    .sort((a, b) => {
                      const order = { stale: 0, never: 1, ok: 2 } as const;
                      return order[a.status] - order[b.status];
                    })
                    .map((s) => (
                      <tr key={s.abbreviation} style={{ borderBottom: "1px solid #f1f5f9" }}>
                        <Td bold>
                          {s.abbreviation}
                          {s.last_error && (
                            <div
                              title={s.last_error.error}
                              style={{
                                fontSize: 11,
                                fontWeight: 400,
                                color: "#dc2626",
                                maxWidth: 360,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                                marginTop: 2,
                              }}
                            >
                              Last run failed: {s.last_error.error}
                            </div>
                          )}
                        </Td>
                        <Td mono>{s.country_code}</Td>
                        <Td muted>{s.region ?? "—"}</Td>
                        <Td align="right" mono>
                          {s.scrape_frequency_hours}h
                        </Td>
                        <Td align="right" mono muted>
                          {formatHours(s.hours_since_scrape)}
                        </Td>
                        <Td align="right">
                          <StatusPill status={s.status} />
                        </Td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>

            <p style={{ fontSize: 12, color: "#94a3b8", marginTop: 16 }}>
              Generated {new Date(data.generated_at).toLocaleString()} ·{" "}
              <Clock size={11} style={{ verticalAlign: "middle" }} /> grace 12h
            </p>
          </>
        )}
      </div>
      <SiteFooter />
    </main>
  );
}

function SummaryCard({
  label,
  value,
  color,
  icon,
}: {
  label: string;
  value: string | number;
  color?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #e2e8f0",
        borderRadius: 10,
        padding: "14px 16px",
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          color: "#94a3b8",
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 22,
          fontWeight: 700,
          color: color ?? "#0f172a",
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        {icon}
        {value}
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: SourceFreshness["status"] }) {
  const c = STATUS_COLOR[status];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "2px 10px",
        borderRadius: 999,
        background: c.bg,
        color: c.fg,
        fontSize: 12,
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: "0.04em",
      }}
    >
      {status === "ok" ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}
      {c.label}
    </span>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: "right" | "left" }) {
  return (
    <th
      style={{
        textAlign: align ?? "left",
        padding: "10px 16px",
        fontSize: 11,
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        color: "#64748b",
      }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align,
  bold,
  mono,
  muted,
}: {
  children: React.ReactNode;
  align?: "right" | "left";
  bold?: boolean;
  mono?: boolean;
  muted?: boolean;
}) {
  return (
    <td
      style={{
        textAlign: align ?? "left",
        padding: "10px 16px",
        fontSize: 13,
        fontWeight: bold ? 600 : 400,
        fontFamily: mono ? "ui-monospace, monospace" : undefined,
        color: muted ? "#64748b" : "#0f172a",
      }}
    >
      {children}
    </td>
  );
}

function HealthPanel({ health, generatedAt }: { health?: FreshnessResponse["health"]; generatedAt: string }) {
  const box: React.CSSProperties = {
    background: "#fff",
    border: "1px solid #e2e8f0",
    borderRadius: 12,
    padding: "18px 20px",
    marginBottom: 28,
  };
  if (!health || !health.available) {
    return (
      <div style={box}>
        <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Daily data-quality check</h2>
        <p style={{ fontSize: 13, color: "#b45309", margin: "6px 0 0" }}>
          Not available yet: the data_health_runs table (migration 079) hasn&apos;t been applied to this database.
        </p>
      </div>
    );
  }
  const run = health.latest;
  if (!run) {
    return (
      <div style={box}>
        <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Daily data-quality check</h2>
        <p style={{ fontSize: 13, color: "#64748b", margin: "6px 0 0" }}>
          No run recorded yet. It runs daily after the 02:00 UTC Railway scrape.
        </p>
      </div>
    );
  }
  // Age relative to the API response time (keeps render pure).
  const ageH = (Date.parse(generatedAt) - Date.parse(run.run_at)) / 3_600_000;
  const overdue = ageH > 30;
  const findings = (run.findings ?? [])
    .slice()
    .sort((a, b) => {
      const o: Record<Severity, number> = { error: 0, warn: 1, info: 2, ok: 3 };
      return o[a.severity] - o[b.severity];
    });
  const scenarios = run.scenarios?.results ?? [];

  return (
    <div style={box}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Daily data-quality check</h2>
        <span style={{ fontSize: 12, color: overdue ? "#dc2626" : "#64748b" }}>
          Last run {formatHours(ageH)} ago · {new Date(run.run_at).toLocaleString()} · {run.runner}
          {run.duration_s ? ` · ${Math.round(run.duration_s / 60)} min` : ""}
          {overdue ? " · OVERDUE (expected daily)" : ""}
        </span>
      </div>

      <div style={{ display: "flex", gap: 8, margin: "12px 0 14px", flexWrap: "wrap" }}>
        <SevPill sev={run.overall} text={`${run.overall} · ${run.errors} error(s), ${run.warnings} warning(s)`} />
        {health.history.length > 1 && (
          <span style={{ display: "inline-flex", gap: 3, alignItems: "center", marginLeft: 8 }} title="Last 14 runs, newest first">
            {health.history.map((h) => (
              <span
                key={h.id}
                title={`${new Date(h.run_at).toLocaleString()}: ${h.overall} (${h.errors}E/${h.warnings}W)`}
                style={{ width: 10, height: 10, borderRadius: 2, background: SEV_COLOR[h.overall].fg }}
              />
            ))}
          </span>
        )}
      </div>

      <div style={{ display: "grid", gap: 8 }}>
        {findings.map((f) => (
          <details key={f.detector} style={{ borderTop: "1px solid #f1f5f9", paddingTop: 8 }}>
            <summary style={{ cursor: "pointer", fontSize: 13, display: "flex", gap: 8, alignItems: "center" }}>
              <SevPill sev={f.severity} text={f.severity} />
              <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 12, color: "#64748b" }}>{f.detector}</span>
              <span>{f.headline}</span>
            </summary>
            <div style={{ fontSize: 12, color: "#475569", padding: "8px 0 4px 4px" }}>
              {f.detail && <p style={{ margin: "0 0 6px" }}>{f.detail.split("\n")[0]}</p>}
              {f.samples && f.samples.length > 0 && (
                <ul style={{ margin: 0, paddingLeft: 18, fontFamily: "ui-monospace, monospace", fontSize: 11 }}>
                  {f.samples.slice(0, 20).map((x, i) => (
                    <li key={i} style={{ wordBreak: "break-word" }}>{typeof x === "string" ? x : JSON.stringify(x)}</li>
                  ))}
                </ul>
              )}
            </div>
          </details>
        ))}
      </div>

      {scenarios.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase", color: "#94a3b8", marginBottom: 6 }}>
            Live-site scenarios ({run.scenarios?.base})
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <tbody>
              {scenarios.map((r) => (
                <tr key={r.id} style={{ borderTop: "1px solid #f1f5f9" }} title={r.failures.join("\n")}>
                  <td style={{ padding: "5px 8px 5px 0", fontFamily: "ui-monospace, monospace", width: 70 }}>{r.id}</td>
                  <td style={{ padding: "5px 8px", width: 90 }}>
                    <SevPill
                      sev={r.status === "PASS" ? "ok" : r.status === "FAIL" ? "error" : "info"}
                      text={r.status.toLowerCase()}
                    />
                  </td>
                  <td style={{ padding: "5px 8px", color: "#64748b", fontFamily: "ui-monospace, monospace", width: 70 }}>
                    {r.passed ?? 0}/{(r.passed ?? 0) + (r.failed ?? 0)}
                  </td>
                  <td style={{ padding: "5px 0" }}>{r.title}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SevPill({ sev, text }: { sev: Severity; text: string }) {
  const c = SEV_COLOR[sev];
  return (
    <span
      style={{
        display: "inline-block",
        padding: "1px 8px",
        borderRadius: 999,
        background: c.bg,
        color: c.fg,
        fontSize: 11,
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        whiteSpace: "nowrap",
      }}
    >
      {text}
    </span>
  );
}
