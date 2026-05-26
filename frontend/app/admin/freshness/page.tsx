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
}

const STATUS_COLOR: Record<SourceFreshness["status"], { fg: string; bg: string; label: string }> = {
  ok:    { fg: "#0d9488", bg: "#ccfbf1", label: "ok" },
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
              <SummaryCard label="Healthy"          value={data.summary.ok}                color="#0d9488" />
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
                        <Td bold>{s.abbreviation}</Td>
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
