"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Eye, Package, Mail, Inbox, Send, Trophy, TrendingUp, ArrowRight } from "lucide-react";

const FLAGS: Record<string, string> = {
  AU: "🇦🇺", US: "🇺🇸", GB: "🇬🇧", CA: "🇨🇦", DE: "🇩🇪", FR: "🇫🇷", IT: "🇮🇹",
  ES: "🇪🇸", NZ: "🇳🇿", SG: "🇸🇬", IE: "🇮🇪", NO: "🇳🇴", FI: "🇫🇮", CH: "🇨🇭",
  BE: "🇧🇪", NL: "🇳🇱", JP: "🇯🇵", PT: "🇵🇹", GR: "🇬🇷", MY: "🇲🇾", AE: "🇦🇪", EU: "🇪🇺",
};

interface Analytics {
  counts_30d: Record<string, number>;
  counts_7d: Record<string, number>;
  conversion_rate: number;
  top_countries: { country: string; count: number }[];
  top_drugs: { drug_id: string; drug_name: string; views: number }[];
  member_since: string;
  verified: boolean;
  tier: string;
  profile_required?: boolean;
}

export default function SupplierAnalyticsClient() {
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/supplier/analytics")
      .then(r => r.json())
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ maxWidth: 1100, margin: "0 auto", padding: "48px 24px", color: "var(--app-text-4)" }}>Loading analytics…</div>;

  if (data?.profile_required) {
    return (
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "48px 24px", textAlign: "center" }}>
        <h1>Set up your supplier profile first</h1>
        <Link href="/supplier-dashboard/onboarding" style={{ color: "var(--teal)" }}>Start onboarding →</Link>
      </div>
    );
  }
  if (!data) return null;

  const metrics = [
    { key: "profile_view", label: "Profile views", icon: <Eye size={14} />, color: "var(--teal)" },
    { key: "inventory_view", label: "Inventory views", icon: <Package size={14} />, color: "var(--teal)" },
    { key: "contact_click", label: "Contact clicks", icon: <Mail size={14} />, color: "var(--high)" },
    { key: "enquiry_received", label: "Enquiries received", icon: <Inbox size={14} />, color: "var(--high)" },
    { key: "quote_submitted", label: "Quotes submitted", icon: <Send size={14} />, color: "var(--app-text)" },
    { key: "quote_won", label: "Deals won", icon: <Trophy size={14} />, color: "var(--low)" },
  ];

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "32px 24px" }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--app-text-4)", marginBottom: 6 }}>
          Supplier Dashboard
        </div>
        <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 6 }}>Analytics</h1>
        <div style={{ fontSize: 13, color: "var(--app-text-4)" }}>
          Last 30 days · Updated in real time
        </div>
      </div>

      {/* KPI grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 24 }}>
        {metrics.map(m => {
          const v30 = data.counts_30d[m.key] ?? 0;
          const v7 = data.counts_7d[m.key] ?? 0;
          return (
            <div key={m.key} style={{ padding: 18, background: "white", border: "1px solid var(--app-border)", borderRadius: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, color: m.color, marginBottom: 8 }}>
                {m.icon}
                <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" }}>{m.label}</span>
              </div>
              <div style={{ fontSize: 28, fontWeight: 700, fontFamily: "var(--font-dm-mono), monospace", color: "var(--app-text)" }}>
                {v30.toLocaleString()}
              </div>
              <div style={{ fontSize: 12, color: "var(--app-text-4)", marginTop: 4 }}>
                {v7} in last 7 days
              </div>
            </div>
          );
        })}
      </div>

      {/* Conversion rate hero */}
      <div style={{
        padding: 24, background: "var(--app-text)", color: "white",
        borderRadius: 12, marginBottom: 24,
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap",
      }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: "#5EEAD4", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 6 }}>
            Quote conversion rate
          </div>
          <div style={{ fontSize: 14, color: "#CADCFC" }}>
            Of every 100 enquiries received, you submit a quote on{" "}
            <strong style={{ color: "white", fontSize: 16 }}>{data.conversion_rate}</strong>.
          </div>
        </div>
        <div style={{ fontSize: 56, fontWeight: 700, fontFamily: "Georgia, serif", color: "#5EEAD4" }}>
          {data.conversion_rate}%
        </div>
      </div>

      {/* Top tables */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {/* Top countries */}
        <div style={{ padding: 18, background: "white", border: "1px solid var(--app-border)", borderRadius: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--app-text-4)", marginBottom: 12 }}>
            Top buyer countries (30d)
          </div>
          {data.top_countries.length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--app-text-4)", padding: "20px 0", textAlign: "center" }}>
              No enquiries yet
            </div>
          ) : (
            data.top_countries.map(c => {
              const max = Math.max(...data.top_countries.map(x => x.count));
              return (
                <div key={c.country} style={{ display: "grid", gridTemplateColumns: "auto 1fr 50px", gap: 10, alignItems: "center", padding: "8px 0" }}>
                  <span style={{ fontSize: 18 }}>{FLAGS[c.country] ?? c.country}</span>
                  <div style={{ height: 6, background: "var(--app-bg)", borderRadius: 3 }}>
                    <div style={{ height: "100%", width: `${(c.count / max) * 100}%`, background: "var(--teal)", borderRadius: 3 }} />
                  </div>
                  <span style={{ fontSize: 13, fontWeight: 600, fontFamily: "var(--font-dm-mono), monospace", textAlign: "right" }}>
                    {c.count}
                  </span>
                </div>
              );
            })
          )}
        </div>

        {/* Top drugs */}
        <div style={{ padding: 18, background: "white", border: "1px solid var(--app-border)", borderRadius: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--app-text-4)", marginBottom: 12 }}>
            Most-viewed drugs (30d)
          </div>
          {data.top_drugs.length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--app-text-4)", padding: "20px 0", textAlign: "center" }}>
              No views yet
            </div>
          ) : (
            data.top_drugs.map(d => (
              <Link key={d.drug_id} href={`/drugs/${d.drug_id}`} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid var(--app-border)", textDecoration: "none", color: "var(--app-text)" }}>
                <span style={{ fontSize: 13, fontWeight: 500 }}>{d.drug_name}</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--teal)", fontFamily: "var(--font-dm-mono), monospace" }}>
                  {d.views}
                </span>
              </Link>
            ))
          )}
        </div>
      </div>

      {/* Tip */}
      <div style={{ marginTop: 24, padding: 16, background: "var(--teal-bg)", border: "1px solid var(--teal-b)", borderRadius: 10, fontSize: 13, color: "var(--app-text-3)", display: "flex", alignItems: "center", gap: 14 }}>
        <TrendingUp size={20} color="var(--teal)" />
        <div style={{ flex: 1 }}>
          <strong style={{ color: "var(--app-text)" }}>Boost your conversion:</strong>{" "}
          Suppliers who quote within 6 hours of an enquiry win 3.2× more often. Set up email notifications in Profile.
        </div>
        <Link href="/supplier-dashboard/profile" style={{ fontSize: 13, color: "var(--teal)", fontWeight: 600, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}>
          Profile <ArrowRight size={12} />
        </Link>
      </div>
    </div>
  );
}
