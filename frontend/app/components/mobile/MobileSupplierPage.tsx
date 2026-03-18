"use client";
import { useState } from "react";
import type { SupplierPartner } from "@/lib/suppliers";

const COUNTRY_NAMES: Record<string, string> = {
  AU: "Australia", GB: "United Kingdom", US: "United States", CA: "Canada",
  DE: "Germany", FR: "France", NZ: "New Zealand", SG: "Singapore",
};

interface Props {
  partner: SupplierPartner;
  drugName: string;
  drugId: string;
  severity: string;
  userCountry: string;
  onBack: () => void;
}

export function MobileSupplierPage({ partner, drugName, severity, userCountry, onBack }: Props) {
  const [quantity, setQuantity] = useState("");
  const [urgency, setUrgency] = useState(
    severity === "critical" ? "critical" : severity === "high" ? "urgent" : "routine"
  );
  const [organisation, setOrganisation] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit() {
    setSubmitting(true);
    try {
      const res = await fetch("/api/supplier-enquiry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          drugName, quantity, urgency, organisation, message,
          country: userCountry,
        }),
      });
      if (res.ok) setSubmitted(true);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{
      maxWidth: 480, margin: "0 auto", minHeight: "100dvh",
      display: "flex", flexDirection: "column",
      background: "var(--app-bg)", position: "relative",
    }}>
      <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px", paddingBottom: 80 }}>
        <button
          onClick={onBack}
          style={{
            fontSize: 11, color: "var(--app-text-4)", background: "none",
            border: "none", cursor: "pointer", padding: 0, marginBottom: 12,
            fontFamily: "Inter, sans-serif",
          }}
        >
          &larr; {drugName}
        </button>

        {/* Partner header */}
        <div style={{
          display: "flex", alignItems: "center", gap: 10, marginBottom: 16,
          paddingBottom: 14, borderBottom: "1px solid var(--app-border)",
        }}>
          <div style={{
            width: 40, height: 40, borderRadius: 8, background: "var(--app-bg-2)",
            border: "1px solid var(--app-border)", display: "flex", alignItems: "center",
            justifyContent: "center", fontSize: 11, fontWeight: 600, color: "var(--app-text-3)",
            flexShrink: 0,
          }}>
            {partner.logoInitials}
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 500, color: "var(--app-text)" }}>{partner.name}</div>
            <div style={{ fontSize: 11, color: "var(--app-text-4)" }}>
              {COUNTRY_NAMES[userCountry] ?? userCountry} &middot; {partner.type}
            </div>
            {partner.verified && (
              <div style={{ fontSize: 10, color: "var(--low)" }}>
                &#10003; Verified Mederti partner
              </div>
            )}
          </div>
        </div>

        {submitted ? (
          <div style={{ textAlign: "center", padding: "40px 0" }}>
            <div style={{ fontSize: 40, marginBottom: 16, color: "var(--low)" }}>&#10003;</div>
            <div style={{ fontSize: 16, fontWeight: 500, marginBottom: 8, color: "var(--app-text)" }}>
              Enquiry sent
            </div>
            <div style={{ fontSize: 13, color: "var(--app-text-3)", marginBottom: 24, lineHeight: 1.6 }}>
              {partner.name} will respond within {partner.responseTime}.
            </div>
            <button
              onClick={onBack}
              style={{
                padding: "10px 24px", borderRadius: 10, background: "var(--teal)",
                color: "#fff", border: "none", fontSize: 13, fontWeight: 500,
                cursor: "pointer", fontFamily: "Inter, sans-serif",
              }}
            >
              Done
            </button>
          </div>
        ) : (
          <>
            {/* Drug field (read-only) */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 500, color: "var(--app-text-3)", marginBottom: 4 }}>
                Drug required
              </div>
              <div style={{
                padding: "9px 12px", borderRadius: 8, border: "1px solid var(--app-border)",
                fontSize: 13, color: "var(--app-text)", background: "var(--app-bg-2)",
              }}>
                {drugName}
              </div>
            </div>

            {/* Quantity */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 500, color: "var(--app-text-3)", marginBottom: 4 }}>
                Quantity needed
              </div>
              <input
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder="e.g. 200 units / month"
                style={{
                  width: "100%", padding: "9px 12px", borderRadius: 8,
                  border: "1px solid var(--app-border)", fontSize: 13, color: "var(--app-text)",
                  background: "var(--app-bg)", fontFamily: "Inter, sans-serif", outline: "none",
                  boxSizing: "border-box",
                }}
              />
            </div>

            {/* Urgency */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 500, color: "var(--app-text-3)", marginBottom: 6 }}>
                Urgency
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
                {(["Routine", "Urgent", "Critical"] as const).map((u) => {
                  const val = u.toLowerCase();
                  const active = urgency === val;
                  return (
                    <button
                      key={u}
                      onClick={() => setUrgency(val)}
                      style={{
                        padding: "9px 4px", borderRadius: 8, fontSize: 12,
                        cursor: "pointer", fontFamily: "Inter, sans-serif",
                        border: `1px solid ${active ? "var(--crit-b)" : "var(--app-border)"}`,
                        background: active ? "var(--crit-bg)" : "var(--app-bg)",
                        color: active ? "var(--crit)" : "var(--app-text-3)",
                        fontWeight: active ? 500 : 400,
                      }}
                    >
                      {u}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Organisation */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 500, color: "var(--app-text-3)", marginBottom: 4 }}>
                Organisation
              </div>
              <input
                value={organisation}
                onChange={(e) => setOrganisation(e.target.value)}
                placeholder="Your pharmacy or hospital name"
                style={{
                  width: "100%", padding: "9px 12px", borderRadius: 8,
                  border: "1px solid var(--app-border)", fontSize: 13, color: "var(--app-text)",
                  background: "var(--app-bg)", fontFamily: "Inter, sans-serif", outline: "none",
                  boxSizing: "border-box",
                }}
              />
            </div>

            {/* Message */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 11, fontWeight: 500, color: "var(--app-text-3)", marginBottom: 4 }}>
                Message <span style={{ color: "var(--app-text-4)", fontWeight: 400 }}>(optional)</span>
              </div>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Any additional context..."
                style={{
                  width: "100%", padding: "9px 12px", borderRadius: 8,
                  border: "1px solid var(--app-border)", fontSize: 13, color: "var(--app-text)",
                  background: "var(--app-bg)", fontFamily: "Inter, sans-serif",
                  height: 80, resize: "none", outline: "none",
                  boxSizing: "border-box",
                }}
              />
            </div>

            {/* Submit */}
            <button
              onClick={handleSubmit}
              disabled={submitting}
              style={{
                width: "100%", padding: 14, borderRadius: 12,
                background: submitting ? "var(--teal-l)" : "var(--teal)",
                border: "none", color: "#fff", fontSize: 15, fontWeight: 600,
                cursor: submitting ? "not-allowed" : "pointer",
                fontFamily: "Inter, sans-serif", marginBottom: 8,
              }}
            >
              {submitting ? "Sending..." : `Send enquiry to ${partner.name}`}
            </button>
            <div style={{ fontSize: 10, color: "var(--app-text-4)", textAlign: "center", lineHeight: 1.5 }}>
              {partner.name} will respond within {partner.responseTime} &middot; Shared only with this supplier
            </div>
          </>
        )}
      </div>
    </div>
  );
}
