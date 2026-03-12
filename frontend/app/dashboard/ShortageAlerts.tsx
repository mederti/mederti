"use client";

import { useEffect, useState, useRef } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import Link from "next/link";
import { Bell } from "lucide-react";

const FLAGS: Record<string, string> = {
  AU: "\u{1F1E6}\u{1F1FA}",
  US: "\u{1F1FA}\u{1F1F8}",
  GB: "\u{1F1EC}\u{1F1E7}",
  CA: "\u{1F1E8}\u{1F1E6}",
  DE: "\u{1F1E9}\u{1F1EA}",
  FR: "\u{1F1EB}\u{1F1F7}",
  IT: "\u{1F1EE}\u{1F1F9}",
  ES: "\u{1F1EA}\u{1F1F8}",
  NZ: "\u{1F1F3}\u{1F1FF}",
  SG: "\u{1F1F8}\u{1F1EC}",
  EU: "\u{1F1EA}\u{1F1FA}",
  FI: "\u{1F1EB}\u{1F1EE}",
};

const SEV: Record<
  string,
  { color: string; bg: string; border: string; label: string }
> = {
  critical: {
    color: "#dc2626",
    bg: "#fef2f2",
    border: "#fecaca",
    label: "Critical",
  },
  high: {
    color: "#ea580c",
    bg: "#fff7ed",
    border: "#fed7aa",
    label: "High",
  },
  medium: {
    color: "#ca8a04",
    bg: "#fefce8",
    border: "#fef08a",
    label: "Medium",
  },
  low: {
    color: "#16a34a",
    bg: "#f0fdf4",
    border: "#bbf7d0",
    label: "Low",
  },
};

interface AlertRow {
  shortage_id: string;
  drug_id: string;
  drug_name: string;
  severity: string;
  country_code: string;
  source_name: string;
  updated_at: string;
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function ShortageAlerts() {
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [loading, setLoading] = useState(true);
  const sbRef = useRef(createBrowserClient());

  useEffect(() => {
    const supabase = sbRef.current;

    async function load() {
      try {
        const h48 = new Date(
          Date.now() - 48 * 60 * 60 * 1000
        ).toISOString();

        const { data } = await supabase
          .from("shortage_events")
          .select(
            "shortage_id, drug_id, severity, country_code, updated_at, drugs(generic_name), data_sources(name)"
          )
          .gte("updated_at", h48)
          .in("status", ["active", "anticipated"])
          .order("severity", { ascending: true })
          .order("updated_at", { ascending: false })
          .limit(20);

        if (data) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          setAlerts(
            (data as any[]).map((r) => ({
              shortage_id: r.shortage_id,
              drug_id: r.drug_id,
              drug_name: r.drugs?.generic_name ?? "Unknown drug",
              severity: (r.severity ?? "low").toLowerCase(),
              country_code: r.country_code ?? "",
              source_name: r.data_sources?.name ?? "—",
              updated_at: r.updated_at,
            }))
          );
        }
      } catch (err) {
        console.error("[ShortageAlerts] load error:", err);
      } finally {
        setLoading(false);
      }
    }

    load();
    const iv = setInterval(load, 5 * 60 * 1000);
    return () => clearInterval(iv);
  }, []);

  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #e2e8f0",
        borderRadius: 12,
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "14px 20px",
          borderBottom: "1px solid #e2e8f0",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: 7,
              background: "#fef2f2",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Bell
              style={{ width: 14, height: 14, strokeWidth: 1.5 }}
              color="#dc2626"
            />
          </div>
          <span
            style={{ fontSize: 13, fontWeight: 600, color: "#0f172a" }}
          >
            New &amp; Updated Shortage Alerts
          </span>
        </div>
        <span
          style={{
            fontSize: 11,
            color: "#94a3b8",
            fontFamily: "var(--font-dm-mono), monospace",
          }}
        >
          last 48h · refreshes every 5m
        </span>
      </div>

      {/* Content */}
      {loading ? (
        <div
          style={{
            padding: "40px 20px",
            textAlign: "center",
            color: "#94a3b8",
            fontSize: 13,
          }}
        >
          Loading alerts…
        </div>
      ) : alerts.length === 0 ? (
        <div
          style={{
            padding: "40px 20px",
            textAlign: "center",
            color: "#94a3b8",
            fontSize: 13,
          }}
        >
          No new shortage alerts in the last 48 hours.
        </div>
      ) : (
        <div>
          {alerts.map((a, i) => {
            const sev = SEV[a.severity] ?? SEV.low;
            return (
              <Link
                key={a.shortage_id}
                href={`/drugs/${a.drug_id}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "12px 20px",
                  borderBottom:
                    i < alerts.length - 1 ? "1px solid #f1f5f9" : "none",
                  textDecoration: "none",
                  transition: "background 0.1s",
                }}
                className="db-alert-row"
              >
                {/* Severity dot */}
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: sev.color,
                    flexShrink: 0,
                  }}
                />

                {/* Drug name */}
                <div
                  style={{
                    flex: 1,
                    minWidth: 0,
                    fontSize: 14,
                    fontWeight: 500,
                    color: "#0f172a",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {a.drug_name}
                </div>

                {/* Severity badge */}
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    padding: "3px 8px",
                    borderRadius: 20,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    background: sev.bg,
                    color: sev.color,
                    border: `1px solid ${sev.border}`,
                    flexShrink: 0,
                  }}
                >
                  {sev.label}
                </span>

                {/* Country flag */}
                <span
                  style={{
                    fontSize: 16,
                    lineHeight: 1,
                    width: 24,
                    textAlign: "center",
                    flexShrink: 0,
                  }}
                >
                  {FLAGS[a.country_code] ?? "\u{1F310}"}
                </span>

                {/* Source + time */}
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-end",
                    gap: 2,
                    flexShrink: 0,
                    minWidth: 100,
                  }}
                >
                  <span
                    style={{
                      fontSize: 11,
                      color: "#64748b",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      maxWidth: 140,
                    }}
                  >
                    {a.source_name}
                  </span>
                  <span
                    style={{
                      fontSize: 11,
                      color: "#94a3b8",
                      fontFamily: "var(--font-dm-mono), monospace",
                    }}
                  >
                    {timeAgo(a.updated_at)}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      <style>{`
        .db-alert-row:hover { background: #f8fafc !important; }
      `}</style>
    </div>
  );
}
