"use client";

import { useEffect, useState, useCallback } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { AlertTriangle, TrendingUp, CheckCircle2, Clock } from "lucide-react";

interface Stats {
  totalActive: number;
  criticalCount: number;
  newLast24h: number;
  resolvedLast7d: number;
}

const ICON = { width: 16, height: 16, strokeWidth: 1.6 } as const;

export default function SituationBanner() {
  const [stats, setStats] = useState<Stats | null>(null);
  const supabase = createBrowserClient();

  const load = useCallback(async () => {
    const now = new Date();
    const h24 = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const d7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [activeRes, critRes, newRes, resolvedRes] = await Promise.allSettled([
      supabase
        .from("shortage_events")
        .select("id", { count: "exact", head: true })
        .eq("status", "active"),
      supabase
        .from("shortage_events")
        .select("id", { count: "exact", head: true })
        .eq("status", "active")
        .eq("severity", "critical"),
      supabase
        .from("shortage_events")
        .select("id", { count: "exact", head: true })
        .gte("created_at", h24),
      supabase
        .from("shortage_events")
        .select("id", { count: "exact", head: true })
        .eq("status", "resolved")
        .gte("updated_at", d7),
    ]);

    setStats({
      totalActive:
        activeRes.status === "fulfilled" ? (activeRes.value.count ?? 0) : 0,
      criticalCount:
        critRes.status === "fulfilled" ? (critRes.value.count ?? 0) : 0,
      newLast24h:
        newRes.status === "fulfilled" ? (newRes.value.count ?? 0) : 0,
      resolvedLast7d:
        resolvedRes.status === "fulfilled"
          ? (resolvedRes.value.count ?? 0)
          : 0,
    });
  }, [supabase]);

  useEffect(() => {
    load();
    const iv = setInterval(load, 5 * 60 * 1000);
    return () => clearInterval(iv);
  }, [load]);

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
      label: "New in 24h",
      value: stats?.newLast24h ?? "—",
      icon: TrendingUp,
      color: "#ea580c",
      bg: "#fff7ed",
      border: "#fed7aa",
    },
    {
      label: "Resolved (7d)",
      value: stats?.resolvedLast7d ?? "—",
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
                ) : (
                  typeof c.value === "number"
                    ? c.value.toLocaleString()
                    : c.value
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
