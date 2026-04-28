"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Trophy, X, Clock, Eye, FileText, ArrowRight, TrendingUp } from "lucide-react";

const FLAGS: Record<string, string> = {
  AU: "🇦🇺", US: "🇺🇸", GB: "🇬🇧", CA: "🇨🇦", DE: "🇩🇪", FR: "🇫🇷", IT: "🇮🇹",
  ES: "🇪🇸", NZ: "🇳🇿", SG: "🇸🇬", IE: "🇮🇪", NO: "🇳🇴", FI: "🇫🇮", CH: "🇨🇭",
  BE: "🇧🇪", NL: "🇳🇱", JP: "🇯🇵", PT: "🇵🇹", GR: "🇬🇷", MY: "🇲🇾", AE: "🇦🇪", EU: "🇪🇺",
};

interface Quote {
  id: string;
  enquiry_id: string;
  quote_amount: number | null;
  currency: string;
  available_quantity: string | null;
  delivery_eta: string | null;
  notes: string | null;
  pipeline_stage: string;
  valid_until: string | null;
  viewed_by_buyer_at: string | null;
  won_at: string | null;
  lost_reason: string | null;
  created_at: string;
  supplier_enquiries: {
    id: string;
    drug_name: string;
    drug_id: string;
    country: string;
    urgency: string;
    organisation: string | null;
    user_email: string | null;
    created_at: string;
  };
}

const STAGES = [
  { key: "submitted", label: "Submitted", icon: <Clock size={14} />, color: "var(--app-text-3)", bg: "var(--app-bg)" },
  { key: "viewed", label: "Viewed", icon: <Eye size={14} />, color: "var(--teal)", bg: "var(--teal-bg)" },
  { key: "negotiating", label: "Negotiating", icon: <FileText size={14} />, color: "var(--high)", bg: "var(--high-bg)" },
  { key: "won", label: "Won", icon: <Trophy size={14} />, color: "var(--low)", bg: "var(--low-bg)" },
  { key: "lost", label: "Lost", icon: <X size={14} />, color: "var(--crit)", bg: "var(--crit-bg)" },
] as const;

function timeAgo(iso: string) {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 60) return `${m}m`;
  if (m < 1440) return `${Math.floor(m / 60)}h`;
  return `${Math.floor(m / 1440)}d`;
}

export default function SupplierQuotesClient() {
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);

  function refresh() {
    fetch("/api/supplier/quotes")
      .then(r => r.json())
      .then(d => setQuotes(d.quotes ?? []))
      .catch(() => setQuotes([]))
      .finally(() => setLoading(false));
  }

  useEffect(() => { refresh(); }, []);

  async function updateStage(id: string, stage: string, lostReason?: string) {
    setUpdating(id);
    try {
      await fetch("/api/supplier/quotes", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, pipeline_stage: stage, lost_reason: lostReason || null }),
      });
      refresh();
    } finally {
      setUpdating(null);
    }
  }

  const grouped: Record<string, Quote[]> = {};
  for (const q of quotes) {
    const stage = q.pipeline_stage || "submitted";
    if (!grouped[stage]) grouped[stage] = [];
    grouped[stage].push(q);
  }

  // Stats
  const totalValue = quotes
    .filter(q => q.pipeline_stage === "won" && q.quote_amount)
    .reduce((sum, q) => sum + (q.quote_amount || 0), 0);
  const wonCount = (grouped.won || []).length;
  const totalSubmitted = quotes.length;
  const winRate = totalSubmitted > 0 ? Math.round((wonCount / totalSubmitted) * 100) : 0;

  if (loading) {
    return <div style={{ maxWidth: 1100, margin: "0 auto", padding: "48px 24px", color: "var(--app-text-4)" }}>Loading quotes…</div>;
  }

  return (
    <div style={{ maxWidth: 1400, margin: "0 auto", padding: "32px 24px" }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--app-text-4)", marginBottom: 6 }}>
          Supplier Dashboard
        </div>
        <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>Quotes Pipeline</h1>
        <p style={{ fontSize: 14, color: "var(--app-text-4)" }}>
          Track every quote you've submitted from submitted to won.
        </p>
      </div>

      {/* KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 24 }}>
        <Kpi label="Quotes submitted" value={totalSubmitted.toString()} />
        <Kpi label="Wins" value={wonCount.toString()} color="var(--low)" />
        <Kpi label="Win rate" value={`${winRate}%`} color="var(--teal)" />
        <Kpi label="Won deal value" value={totalValue > 0 ? `$${totalValue.toLocaleString()}` : "—"} color="var(--low)" />
      </div>

      {/* Pipeline columns */}
      {quotes.length === 0 ? (
        <div style={{ padding: "60px 24px", textAlign: "center", background: "white", borderRadius: 10, border: "1px solid var(--app-border)" }}>
          <FileText size={32} color="var(--app-text-4)" style={{ margin: "0 auto 14px" }} />
          <div style={{ fontSize: 15, fontWeight: 600 }}>No quotes yet</div>
          <div style={{ fontSize: 13, color: "var(--app-text-4)", marginTop: 6, marginBottom: 16 }}>
            Submit a quote against a buyer enquiry to see it here.
          </div>
          <Link href="/supplier-dashboard/inbox" style={{
            display: "inline-flex", alignItems: "center", gap: 8,
            padding: "10px 18px", background: "var(--teal)", color: "white",
            borderRadius: 6, fontSize: 13, fontWeight: 600, textDecoration: "none",
          }}>
            Go to inbox <ArrowRight size={14} />
          </Link>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, alignItems: "flex-start" }}>
          {STAGES.map(stage => {
            const items = grouped[stage.key] || [];
            return (
              <div key={stage.key} style={{
                background: "var(--app-bg)", border: "1px solid var(--app-border)", borderRadius: 10,
                padding: 12, minHeight: 240,
              }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, padding: "0 4px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, color: stage.color }}>
                    {stage.icon}
                    <span style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                      {stage.label}
                    </span>
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "var(--app-text-4)", padding: "2px 8px", background: "white", borderRadius: 12 }}>
                    {items.length}
                  </span>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {items.map(q => {
                    const enq = q.supplier_enquiries;
                    return (
                      <div key={q.id} style={{
                        padding: 12, background: "white", borderRadius: 8,
                        border: "1px solid var(--app-border)",
                        opacity: updating === q.id ? 0.5 : 1,
                      }}>
                        <Link href={`/drugs/${enq.drug_id}`} style={{ fontSize: 13, fontWeight: 600, color: "var(--app-text)", textDecoration: "none", display: "block", marginBottom: 6 }}>
                          {enq.drug_name.length > 32 ? enq.drug_name.slice(0, 32) + "…" : enq.drug_name}
                        </Link>
                        <div style={{ fontSize: 11, color: "var(--app-text-4)", marginBottom: 8 }}>
                          {FLAGS[enq.country] ?? enq.country} {enq.organisation || enq.country} · {timeAgo(q.created_at)}
                        </div>
                        {q.quote_amount && (
                          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--app-text)", marginBottom: 8, fontFamily: "var(--font-dm-mono), monospace" }}>
                            {q.currency} {q.quote_amount.toFixed(2)}
                          </div>
                        )}

                        {/* Stage actions */}
                        {q.pipeline_stage !== "won" && q.pipeline_stage !== "lost" && (
                          <div style={{ display: "flex", gap: 4, marginTop: 8, flexWrap: "wrap" }}>
                            <button
                              onClick={() => updateStage(q.id, "won")}
                              style={{ padding: "4px 8px", fontSize: 11, fontWeight: 600, background: "var(--low-bg)", color: "var(--low)", border: "1px solid var(--low-b)", borderRadius: 4, cursor: "pointer" }}
                            >
                              Mark won
                            </button>
                            <button
                              onClick={() => {
                                const reason = prompt("Reason lost (optional):");
                                if (reason !== null) updateStage(q.id, "lost", reason);
                              }}
                              style={{ padding: "4px 8px", fontSize: 11, fontWeight: 600, background: "var(--app-bg)", color: "var(--app-text-4)", border: "1px solid var(--app-border)", borderRadius: 4, cursor: "pointer" }}
                            >
                              Lost
                            </button>
                          </div>
                        )}

                        {q.pipeline_stage === "lost" && q.lost_reason && (
                          <div style={{ fontSize: 11, color: "var(--app-text-4)", fontStyle: "italic", marginTop: 6 }}>
                            {q.lost_reason}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ padding: 16, background: "white", border: "1px solid var(--app-border)", borderRadius: 10 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: "var(--app-text-4)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ fontSize: 24, fontWeight: 700, color: color ?? "var(--app-text)", fontFamily: "var(--font-dm-mono), monospace" }}>
        {value}
      </div>
    </div>
  );
}
