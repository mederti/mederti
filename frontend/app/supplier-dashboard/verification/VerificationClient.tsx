"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ShieldCheck, FileText, Clock, AlertCircle, CheckCircle2, Plus, X } from "lucide-react";

const DOC_TYPES = [
  { key: "wholesale_license", label: "Wholesale licence" },
  { key: "gmp_certificate", label: "GMP certificate" },
  { key: "iso_certification", label: "ISO certification" },
  { key: "business_registration", label: "Business registration" },
  { key: "tax_certificate", label: "Tax / VAT certificate" },
  { key: "other", label: "Other" },
];

interface Doc {
  id: string;
  document_type: string;
  document_name: string;
  expires_on: string | null;
  status: string;
  created_at: string;
  rejection_reason: string | null;
}

interface DraftDoc {
  document_type: string;
  document_name: string;
  expires_on: string;
}

interface VerificationData {
  verification_status: string;
  verified: boolean;
  requested_at: string | null;
  documents: Doc[];
  profile_required?: boolean;
}

export default function VerificationClient() {
  const [data, setData] = useState<VerificationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState<DraftDoc[]>([
    { document_type: "wholesale_license", document_name: "", expires_on: "" },
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  function refresh() {
    fetch("/api/supplier/verification")
      .then(r => r.json())
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }

  useEffect(() => { refresh(); }, []);

  async function submit() {
    setSubmitting(true);
    try {
      const valid = drafts.filter(d => d.document_type && d.document_name.trim());
      const res = await fetch("/api/supplier/verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documents: valid }),
      });
      if (res.ok) {
        setSubmitted(true);
        setTimeout(() => { setSubmitted(false); refresh(); }, 1500);
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <div style={{ maxWidth: 720, margin: "0 auto", padding: "48px 24px", color: "var(--app-text-4)" }}>Loading…</div>;

  if (data?.profile_required) {
    return (
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "48px 24px", textAlign: "center" }}>
        <Link href="/supplier-dashboard/onboarding" style={{ color: "var(--teal)" }}>Set up your profile first →</Link>
      </div>
    );
  }
  if (!data) return null;

  const status = data.verification_status;

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "32px 24px" }}>
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--app-text-4)", marginBottom: 6 }}>
          Supplier Dashboard
        </div>
        <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>Get Verified</h1>
        <p style={{ fontSize: 14, color: "var(--app-text-4)", lineHeight: 1.6 }}>
          Verified suppliers appear first on drug pages and earn buyer trust. Free for all tiers.
        </p>
      </div>

      {/* Status block */}
      {status === "verified" && (
        <StatusBlock
          color="var(--low)"
          bg="var(--low-bg)"
          border="var(--low-b)"
          icon={<ShieldCheck size={24} />}
          title="Verified supplier"
          body="You appear first on drug pages and have a verified badge on your profile and listings."
        />
      )}
      {status === "pending" && (
        <StatusBlock
          color="var(--high)"
          bg="var(--high-bg)"
          border="var(--high-b)"
          icon={<Clock size={24} />}
          title="Verification in review"
          body={`Submitted ${data.requested_at ? new Date(data.requested_at).toLocaleDateString() : "recently"}. We typically respond within 2 business days.`}
        />
      )}
      {status === "rejected" && (
        <StatusBlock
          color="var(--crit)"
          bg="var(--crit-bg)"
          border="var(--crit-b)"
          icon={<AlertCircle size={24} />}
          title="Verification needs more info"
          body="Submit additional documents below to reapply."
        />
      )}

      {/* Benefits */}
      {status !== "verified" && status !== "pending" && (
        <div style={{ background: "white", border: "1px solid var(--app-border)", borderRadius: 12, padding: 24, marginBottom: 24 }}>
          <div style={{ fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--app-text-4)", marginBottom: 14 }}>
            Why get verified?
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Benefit text="Verified badge displayed on every drug page where your stock appears" />
            <Benefit text="Listed first in search results and supplier directory" />
            <Benefit text="3.4× higher buyer enquiry conversion (industry average)" />
            <Benefit text="Trust mark in your enquiry response emails" />
            <Benefit text="Free for all subscription tiers" />
          </div>
        </div>
      )}

      {/* Documents history */}
      {data.documents.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--app-text-4)", marginBottom: 10 }}>
            Submitted documents
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {data.documents.map(d => {
              const typeMeta = DOC_TYPES.find(t => t.key === d.document_type);
              const statusColor = d.status === "approved" ? "var(--low)" : d.status === "rejected" ? "var(--crit)" : "var(--app-text-4)";
              return (
                <div key={d.id} style={{ padding: 14, background: "white", border: "1px solid var(--app-border)", borderRadius: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>
                      {d.document_name} <span style={{ color: "var(--app-text-4)", fontWeight: 400 }}>· {typeMeta?.label ?? d.document_type}</span>
                    </div>
                    {d.rejection_reason && <div style={{ fontSize: 11, color: "var(--crit)", marginTop: 4 }}>{d.rejection_reason}</div>}
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 700, color: statusColor, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                    {d.status}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Submit form */}
      {status !== "verified" && status !== "pending" && (
        <div style={{ background: "white", border: "1px solid var(--app-border)", borderRadius: 12, padding: 24 }}>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>Request verification</div>
          <p style={{ fontSize: 13, color: "var(--app-text-4)", marginBottom: 18 }}>
            Declare which documents you can provide. We'll email <strong>verification@mederti.com</strong> within 24h to request copies.
          </p>

          {drafts.map((d, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "180px 1fr 130px auto", gap: 8, marginBottom: 10, alignItems: "center" }}>
              <select
                value={d.document_type}
                onChange={e => {
                  const next = [...drafts];
                  next[i].document_type = e.target.value;
                  setDrafts(next);
                }}
                style={selectStyle}
              >
                {DOC_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
              <input
                type="text"
                value={d.document_name}
                onChange={e => {
                  const next = [...drafts];
                  next[i].document_name = e.target.value;
                  setDrafts(next);
                }}
                placeholder="e.g. NSW Pharmacy Wholesale Licence #4892"
                style={selectStyle}
              />
              <input
                type="date"
                value={d.expires_on}
                onChange={e => {
                  const next = [...drafts];
                  next[i].expires_on = e.target.value;
                  setDrafts(next);
                }}
                style={selectStyle}
                placeholder="Expires"
              />
              <button
                onClick={() => setDrafts(drafts.filter((_, j) => j !== i))}
                style={{ padding: 8, background: "none", border: "none", cursor: "pointer", color: "var(--app-text-4)" }}
              >
                <X size={14} />
              </button>
            </div>
          ))}

          <button
            onClick={() => setDrafts([...drafts, { document_type: "other", document_name: "", expires_on: "" }])}
            style={{ fontSize: 13, color: "var(--teal)", background: "none", border: "none", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 0" }}
          >
            <Plus size={13} /> Add another document
          </button>

          <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--app-border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            {submitted && <span style={{ fontSize: 13, color: "var(--low)", display: "inline-flex", alignItems: "center", gap: 6 }}><CheckCircle2 size={14} /> Submitted</span>}
            <button
              onClick={submit}
              disabled={submitting || drafts.every(d => !d.document_name.trim())}
              style={{
                padding: "10px 20px", fontSize: 13, fontWeight: 600,
                background: "var(--teal)", color: "white", border: "none", borderRadius: 6,
                cursor: submitting ? "wait" : "pointer",
                opacity: drafts.every(d => !d.document_name.trim()) ? 0.5 : 1,
                marginLeft: "auto",
              }}
            >
              <ShieldCheck size={13} style={{ display: "inline", verticalAlign: "middle", marginRight: 6 }} />
              {submitting ? "Submitting…" : "Submit verification request"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusBlock({ color, bg, border, icon, title, body }: { color: string; bg: string; border: string; icon: React.ReactNode; title: string; body: string }) {
  return (
    <div style={{ padding: 20, background: bg, border: `1px solid ${border}`, borderRadius: 12, marginBottom: 24, display: "flex", gap: 14, alignItems: "flex-start" }}>
      <div style={{ color, marginTop: 2 }}>{icon}</div>
      <div>
        <div style={{ fontSize: 16, fontWeight: 700, color, marginBottom: 4 }}>{title}</div>
        <div style={{ fontSize: 13, color: "var(--app-text-3)", lineHeight: 1.5 }}>{body}</div>
      </div>
    </div>
  );
}

function Benefit({ text }: { text: string }) {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
      <CheckCircle2 size={16} color="var(--low)" style={{ marginTop: 2, flexShrink: 0 }} />
      <span style={{ fontSize: 13, color: "var(--app-text-3)", lineHeight: 1.5 }}>{text}</span>
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  padding: "8px 10px", fontSize: 13,
  border: "1px solid var(--app-border)", borderRadius: 6,
  background: "white", color: "var(--app-text)",
  outline: "none", boxSizing: "border-box", width: "100%",
};
