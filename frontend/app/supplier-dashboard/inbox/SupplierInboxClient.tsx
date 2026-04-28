"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Inbox, AlertTriangle, Mail, Building, Globe, Lock, ArrowRight, CheckCircle2, Send } from "lucide-react";
import QuoteModal from "./QuoteModal";
import StrategicNote from "./StrategicNote";

const FLAGS: Record<string, string> = {
  AU: "🇦🇺", US: "🇺🇸", GB: "🇬🇧", CA: "🇨🇦", DE: "🇩🇪", FR: "🇫🇷", IT: "🇮🇹",
  ES: "🇪🇸", NZ: "🇳🇿", SG: "🇸🇬", IE: "🇮🇪", NO: "🇳🇴", FI: "🇫🇮", CH: "🇨🇭",
  BE: "🇧🇪", NL: "🇳🇱", JP: "🇯🇵", PT: "🇵🇹", GR: "🇬🇷", MY: "🇲🇾", AE: "🇦🇪",
  EU: "🇪🇺",
};

interface Enquiry {
  id: string;
  drug_id: string | null;
  drug_name: string;
  quantity: string | null;
  urgency: string;
  organisation: string | null;
  message: string | null;
  country: string;
  user_email: string | null;
  status: string;
  created_at: string;
  already_quoted: boolean;
}

interface InboxResponse {
  enquiries: Enquiry[];
  profile_required?: boolean;
  message?: string;
  territory?: string[];
  tier?: string;
  total?: number;
}

const URGENCY_STYLE: Record<string, { bg: string; color: string; border: string }> = {
  critical: { bg: "var(--crit-bg)", color: "var(--crit)", border: "var(--crit-b)" },
  urgent:   { bg: "var(--high-bg)", color: "var(--high)", border: "var(--high-b)" },
  routine:  { bg: "var(--app-bg)",  color: "var(--app-text-3)", border: "var(--app-border)" },
};

function timeAgo(iso: string) {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  if (m < 1440) return `${Math.floor(m / 60)}h ago`;
  return `${Math.floor(m / 1440)}d ago`;
}

export default function SupplierInboxClient() {
  const [data, setData] = useState<InboxResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "critical" | "urgent">("all");
  const [quoteFor, setQuoteFor] = useState<Enquiry | null>(null);

  function refresh() {
    fetch("/api/supplier/inbox")
      .then(r => r.json())
      .then(setData)
      .catch(() => setData({ enquiries: [], profile_required: true }))
      .finally(() => setLoading(false));
  }

  useEffect(() => { refresh(); }, []);

  if (loading) {
    return (
      <div style={{ maxWidth: 960, margin: "0 auto", padding: "48px 24px", color: "var(--app-text-4)" }}>
        Loading inbox…
      </div>
    );
  }

  if (data?.profile_required) {
    return (
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "48px 24px" }}>
        <div style={{ textAlign: "center", padding: "60px 32px", background: "var(--app-bg)", borderRadius: 12, border: "1px solid var(--app-border)" }}>
          <div style={{ width: 56, height: 56, borderRadius: "50%", background: "var(--teal-bg)", display: "inline-flex", alignItems: "center", justifyContent: "center", marginBottom: 20 }}>
            <Inbox size={26} color="var(--teal)" />
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 12 }}>Set up your supplier profile</h1>
          <p style={{ fontSize: 15, color: "var(--app-text-4)", lineHeight: 1.6, marginBottom: 28, maxWidth: 480, margin: "0 auto 28px" }}>
            Add your company details and the countries you supply to start receiving real-time enquiries from hospitals and pharmacies across 22 countries.
          </p>
          <Link href="/supplier-dashboard/profile" style={{
            display: "inline-flex", alignItems: "center", gap: 8,
            padding: "12px 24px", background: "var(--teal)", color: "white",
            borderRadius: 8, fontSize: 14, fontWeight: 600, textDecoration: "none",
          }}>
            Set up profile <ArrowRight size={16} />
          </Link>
        </div>
      </div>
    );
  }

  const enquiries = data?.enquiries ?? [];
  const filtered = enquiries.filter(e => {
    if (filter === "all") return true;
    return e.urgency.toLowerCase() === filter;
  });

  const counts = {
    all: enquiries.length,
    critical: enquiries.filter(e => e.urgency.toLowerCase() === "critical").length,
    urgent: enquiries.filter(e => e.urgency.toLowerCase() === "urgent").length,
  };

  const isFree = data?.tier === "free";
  const territory = data?.territory ?? [];

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "32px 24px" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 28, flexWrap: "wrap", gap: 16 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--app-text-4)", marginBottom: 6 }}>
            Supplier Dashboard
          </div>
          <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>Enquiry Inbox</h1>
          <div style={{ display: "flex", gap: 12, fontSize: 13, color: "var(--app-text-4)", flexWrap: "wrap" }}>
            <span><strong style={{ color: "var(--app-text)" }}>{counts.all}</strong> enquiries</span>
            <span>•</span>
            <span>Territory: {territory.length === 0 ? "global" : territory.map(c => FLAGS[c] ?? c).join(" ")}</span>
            <span>•</span>
            <span>Tier: <strong style={{ color: isFree ? "var(--app-text-4)" : "var(--teal)" }}>{(data?.tier ?? "free").toUpperCase()}</strong></span>
          </div>
        </div>
        <Link href="/supplier-dashboard" style={{
          fontSize: 13, color: "var(--app-text-4)", textDecoration: "none",
          padding: "8px 14px", border: "1px solid var(--app-border)", borderRadius: 6,
        }}>
          ← Back to dashboard
        </Link>
      </div>

      {/* Filter chips */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        {(["all", "critical", "urgent"] as const).map(k => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            style={{
              padding: "8px 14px", fontSize: 13, fontWeight: 600,
              background: filter === k ? "var(--app-text)" : "var(--app-bg)",
              color: filter === k ? "white" : "var(--app-text)",
              border: `1px solid ${filter === k ? "var(--app-text)" : "var(--app-border)"}`,
              borderRadius: 6, cursor: "pointer", textTransform: "capitalize",
            }}
          >
            {k} <span style={{ opacity: 0.6, marginLeft: 4 }}>({counts[k]})</span>
          </button>
        ))}
      </div>

      {/* Free tier limit notice */}
      {isFree && (
        <div style={{
          padding: "14px 18px", marginBottom: 20,
          background: "var(--teal-bg)", border: "1px solid var(--teal-b)", borderRadius: 8,
          display: "flex", alignItems: "center", gap: 12, fontSize: 13,
        }}>
          <Lock size={16} color="var(--teal)" />
          <div style={{ flex: 1 }}>
            Free tier shows the latest 10 enquiries. <strong>Upgrade to Pro</strong> to see all incoming buyer requests across your territory.
          </div>
          <Link href="/pricing" style={{
            padding: "6px 14px", background: "var(--teal)", color: "white",
            borderRadius: 6, fontSize: 13, fontWeight: 600, textDecoration: "none",
          }}>
            Upgrade
          </Link>
        </div>
      )}

      {/* Enquiry list */}
      {filtered.length === 0 ? (
        <div style={{ padding: "80px 24px", textAlign: "center", background: "var(--app-bg)", borderRadius: 10, border: "1px solid var(--app-border)" }}>
          <Inbox size={32} color="var(--app-text-4)" style={{ margin: "0 auto 16px" }} />
          <div style={{ fontSize: 15, fontWeight: 600 }}>No enquiries match this filter</div>
          <div style={{ fontSize: 13, color: "var(--app-text-4)", marginTop: 6 }}>
            Try a different filter or check back later.
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {filtered.map(e => {
            const u = URGENCY_STYLE[e.urgency.toLowerCase()] ?? URGENCY_STYLE.routine;
            return (
              <div key={e.id} style={{
                padding: 18, background: "var(--app-card)", border: "1px solid var(--app-border)", borderRadius: 10,
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12, gap: 12, flexWrap: "wrap" }}>
                  <div style={{ flex: 1, minWidth: 200 }}>
                    {e.drug_id ? (
                      <Link href={`/drugs/${e.drug_id}`} style={{ fontSize: 16, fontWeight: 600, color: "var(--app-text)", textDecoration: "none" }}>
                        {e.drug_name}
                      </Link>
                    ) : (
                      <div style={{ fontSize: 16, fontWeight: 600 }}>{e.drug_name}</div>
                    )}
                    <div style={{ fontSize: 12, color: "var(--app-text-4)", marginTop: 4, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                      <span>{FLAGS[e.country] ?? e.country} {e.country}</span>
                      <span>•</span>
                      <span>{timeAgo(e.created_at)}</span>
                      {e.already_quoted && (
                        <>
                          <span>•</span>
                          <span style={{ color: "var(--low)", display: "inline-flex", alignItems: "center", gap: 4 }}>
                            <CheckCircle2 size={12} /> You quoted
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: "4px 10px", borderRadius: 4,
                    background: u.bg, color: u.color, border: `1px solid ${u.border}`,
                    letterSpacing: "0.04em", textTransform: "uppercase",
                  }}>
                    {e.urgency}
                  </span>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, fontSize: 13, marginBottom: e.message ? 12 : 0 }}>
                  {e.quantity && (
                    <div>
                      <div style={{ fontSize: 11, color: "var(--app-text-4)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 2 }}>Quantity</div>
                      <div>{e.quantity}</div>
                    </div>
                  )}
                  {e.organisation && (
                    <div>
                      <div style={{ fontSize: 11, color: "var(--app-text-4)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 2 }}>Organisation</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}><Building size={12} />{e.organisation}</div>
                    </div>
                  )}
                  {e.user_email && (
                    <div>
                      <div style={{ fontSize: 11, color: "var(--app-text-4)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 2 }}>Contact</div>
                      <a href={`mailto:${e.user_email}?subject=Re:%20${encodeURIComponent(e.drug_name)}%20enquiry`} style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--teal)", textDecoration: "none" }}>
                        <Mail size={12} />{e.user_email}
                      </a>
                    </div>
                  )}
                </div>

                {e.message && (
                  <div style={{ padding: 12, background: "var(--app-bg)", borderRadius: 6, fontSize: 13, color: "var(--app-text-3)", lineHeight: 1.5, marginBottom: 12 }}>
                    {e.message}
                  </div>
                )}

                {/* Quote action */}
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, paddingTop: e.message ? 0 : 4 }}>
                  {e.already_quoted ? (
                    <span style={{
                      fontSize: 12, fontWeight: 600, padding: "8px 14px",
                      background: "var(--low-bg)", color: "var(--low)",
                      borderRadius: 6, display: "inline-flex", alignItems: "center", gap: 6,
                    }}>
                      <CheckCircle2 size={13} /> Quote submitted
                    </span>
                  ) : (
                    <button
                      onClick={() => setQuoteFor(e)}
                      style={{
                        padding: "8px 14px", fontSize: 13, fontWeight: 600,
                        background: "var(--teal)", color: "white", border: "none", borderRadius: 6,
                        cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6,
                      }}
                    >
                      <Send size={13} /> Submit quote
                    </button>
                  )}
                </div>

                {/* AI strategic note (lazy-loaded) */}
                <StrategicNote enquiryId={e.id} />
              </div>
            );
          })}
        </div>
      )}

      {/* Quote modal */}
      {quoteFor && (
        <QuoteModal
          enquiry={quoteFor}
          onClose={() => setQuoteFor(null)}
          onSubmitted={() => { setQuoteFor(null); refresh(); }}
        />
      )}
    </div>
  );
}
