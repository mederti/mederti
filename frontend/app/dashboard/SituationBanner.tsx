"use client";

import { useEffect, useState, useRef } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { AlertTriangle, TrendingUp, CheckCircle2 } from "lucide-react";

interface Stats {
  totalActive: number;
  criticalCount: number;
  newCount: number;
  resolvedCount: number;
}

const ICON = { width: 16, height: 16, strokeWidth: 1.6 } as const;

const TIME_MS: Record<string, number> = {
  "24h": 86400000,
  "7d": 604800000,
  "30d": 2592000000,
  "90d": 7776000000,
};

interface SituationBannerProps {
  countryFilter?: string | null;
  timePeriod?: "24h" | "7d" | "30d" | "90d" | null;
}

export default function SituationBanner({
  countryFilter,
  timePeriod,
}: SituationBannerProps) {
  const [stats, setStats] = useState<Stats | null>(null);
  const sbRef = useRef(createBrowserClient());

  useEffect(() => {
    const supabase = sbRef.current;

    async function load() {
      try {
        const newCutoff = new Date(
          Date.now() - (TIME_MS[timePeriod ?? "24h"] ?? 86400000)
        ).toISOString();
        const resolvedCutoff = new Date(
          Date.now() - (TIME_MS[timePeriod ?? "7d"] ?? 604800000)
        ).toISOString();

        let activeQ = supabase
          .from("shortage_events")
          .select("*", { count: "exact", head: true })
          .eq("status", "active");
        let critQ = supabase
          .from("shortage_events")
          .select("*", { count: "exact", head: true })
          .eq("status", "active")
          .eq("severity", "critical");
        let newQ = supabase
          .from("shortage_events")
          .select("*", { count: "exact", head: true })
          .gte("created_at", newCutoff);
        let resolvedQ = supabase
          .from("shortage_events")
          .select("*", { count: "exact", head: true })
          .eq("status", "resolved")
          .gte("updated_at", resolvedCutoff);

        if (countryFilter) {
          activeQ = activeQ.eq("country_code", countryFilter);
          critQ = critQ.eq("country_code", countryFilter);
          newQ = newQ.eq("country_code", countryFilter);
          resolvedQ = resolvedQ.eq("country_code", countryFilter);
        }

        const [activeRes, critRes, newRes, resolvedRes] =
          await Promise.allSettled([activeQ, critQ, newQ, resolvedQ]);

        setStats({
          totalActive:
            activeRes.status === "fulfilled"
              ? (activeRes.value.count ?? 0)
              : 0,
          criticalCount:
            critRes.status === "fulfilled" ? (critRes.value.count ?? 0) : 0,
          newCount:
            newRes.status === "fulfilled" ? (newRes.value.count ?? 0) : 0,
          resolvedCount:
            resolvedRes.status === "fulfilled"
              ? (resolvedRes.value.count ?? 0)
              : 0,
        });
      } catch (err) {
        console.error("[SituationBanner] load error:", err);
        setStats({
          totalActive: 0,
          criticalCount: 0,
          newCount: 0,
          resolvedCount: 0,
        });
      }
    }

    load();
    const iv = setInterval(load, 5 * 60 * 1000);
    return () => clearInterval(iv);
  }, [countryFilter, timePeriod]);

  const newLabel = `New in ${timePeriod ?? "24h"}`;
  const resolvedLabel = `Resolved (${timePeriod ?? "7d"})`;

  const cards: {
    label: string;
    value: number | string;
    icon: React.ElementType;
    color: string;
    bg: string;
    border: string;
  }[] = [
    {
      label: "Active shortages",
      value: stats?.totalActive ?? "—",
      icon: AlertTriangle,
      color: "#0f172a",
      bg: "#f8fafc",
      border: "#e2e8f0",
    },
    {
      label: "Critical severity",
      value: stats?.criticalCount ?? "—",
      icon: AlertTriangle,
      color: "#dc2626",
      bg: "#fef2f2",
      border: "#fecaca",
    },
    {
      label: newLabel,
      value: stats?.newCount ?? "—",
      icon: TrendingUp,
      color: "#ea580c",
      bg: "#fff7ed",
      border: "#fed7aa",
    },
    {
      label: resolvedLabel,
      value: stats?.resolvedCount ?? "—",
      icon: CheckCircle2,
      color: "#16a34a",
      bg: "#f0fdf4",
      border: "#bbf7d0",
    },
  ];

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(4, 1fr)",
        gap: 14,
      }}
    >
      {cards.map((c) => {
        const Icon = c.icon;
        return (
          <div
            key={c.label}
            style={{
              background: "#fff",
              border: `1px solid ${c.border}`,
              borderRadius: 12,
              padding: "18px 20px",
              display: "flex",
              alignItems: "flex-start",
              gap: 14,
            }}
          >
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 9,
                background: c.bg,
                border: `1px solid ${c.border}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <Icon {...ICON} color={c.color} />
            </div>
            <div>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  color: "#94a3b8",
                  marginBottom: 4,
                }}
              >
                {c.label}
              </div>
              <div
                style={{
                  fontSize: 28,
                  fontWeight: 700,
                  color: c.color,
                  letterSpacing: "-0.02em",
                  lineHeight: 1,
                  fontFamily: "var(--font-dm-mono), monospace",
                }}
              >
                {stats === null ? (
                  <span style={{ color: "#94a3b8" }}>…</span>
                ) : typeof c.value === "number" ? (
                  c.value.toLocaleString()
                ) : (
                  c.value
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
