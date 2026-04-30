"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { SupplierPartner } from "@/lib/suppliers";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  drugName: string;
  drugId: string;
  severity: string;
  partner: SupplierPartner;
  userCountry: string;
  userId?: string;
  userEmail?: string;
  userOrganisation?: string;
}

const COUNTRY_LABELS: Record<string, string> = {
  AU: "Australia", GB: "United Kingdom", US: "United States", CA: "Canada",
  NZ: "New Zealand", DE: "Germany", FR: "France",
};

export function SupplierDrawer({
  isOpen, onClose, drugName, drugId, severity,
  partner, userCountry, userId, userEmail, userOrganisation,
}: Props) {
  const [quantity, setQuantity] = useState("");
  const [urgency, setUrgency] = useState(
    severity === "critical" ? "critical" : severity === "high" ? "urgent" : "routine"
  );
  const [organisation, setOrganisation] = useState(userOrganisation ?? "");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => { if (isOpen) { setSubmitted(false); setError(""); } }, [isOpen]);

  async function handleSubmit() {
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/supplier-enquiry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          drugName, drugId, quantity, urgency,
          organisation, message,
          country: userCountry,
          userId,
          userEmail,
        }),
      });
      if (res.ok) {
        setSubmitted(true);
      } else {
        setError("Something went wrong. Please try again.");
      }
    } catch {
      setError("Something went wrong. Please try again.");
    }
    setSubmitting(false);
  }

  if (!isOpen || !mounted) return null;

  const countryLabel = COUNTRY_LABELS[userCountry] ?? userCountry;

  return createPortal(
    <>
      {/* Backdrop */}
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.25)", zIndex: 200 }} />

      {/* Drawer */}
      <div style={{
        position: "fixed", top: 0, right: 0, bottom: 0, width: 400,
        zIndex: 201, background: "var(--app-bg)",
        borderLeft: "1px solid var(--app-border)",
        display: "flex", flexDirection: "column",
      }}>

        {/* Header */}
        <div style={{ padding: "20px 20px 16px", borderBottom: "1px solid var(--app-border)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <span style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--app-text-4)" }}>
              Find a supplier
            </span>
            <button onClick={onClose} style={{
              width: 28, height: 28, borderRadius: 6,
              background: "var(--app-bg-2)", border: "1px solid var(--app-border)",
              cursor: "pointer", color: "var(--app-text-3)", fontSize: 14,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontFamily: "var(--font-inter), sans-serif",
            }}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M2 2l8 8M10 2l-8 8" />
              </svg>
            </button>
          </div>

          {/* Drug pill */}
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            background: "var(--crit-bg)", border: "1px solid var(--crit-b)",
            borderRadius: 20, padding: "4px 10px",
            fontSize: 11, fontWeight: 500, color: "var(--crit)", marginBottom: 12,
          }}>
            <svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M7 1v4M7 9v4M1 7h4M9 7h4" />
            </svg>
            {drugName}
          </div>

          {/* Partner card */}
          <div style={{ background: "var(--app-bg-2)", borderRadius: 10, padding: "12px 14px", display: "flex", gap: 12, alignItems: "center" }}>
            <div style={{
              width: 40, height: 40, borderRadius: 8,
              background: "var(--app-bg)", border: "1px solid var(--app-border)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 11, fontWeight: 600, color: "var(--app-text-3)", flexShrink: 0,
            }}>
              {partner.logoInitials}
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500, color: "var(--app-text)", marginBottom: 2 }}>{partner.name}</div>
              <div style={{ fontSize: 11, color: "var(--app-text-4)" }}>{countryLabel} · {partner.type}</div>
              {partner.verified && (
                <div style={{ fontSize: 10, color: "var(--low)", marginTop: 3, display: "flex", alignItems: "center", gap: 3 }}>
                  <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2 6l3 3 5-6" />
                  </svg>
                  Verified Mederti partner
                </div>
              )}
            </div>
          </div>
        </div>

        {submitted ? (
          /* Success state */
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 32, textAlign: "center" }}>
            <div style={{
              width: 48, height: 48, borderRadius: "50%",
              background: "var(--low-bg)", border: "1px solid var(--low-b)",
              display: "flex", alignItems: "center", justifyContent: "center",
              marginBottom: 16,
            }}>
              <svg width="22" height="22" viewBox="0 0 16 16" fill="none" stroke="var(--low)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 8l4 4 6-7" />
              </svg>
            </div>
            <div style={{ fontSize: 15, fontWeight: 500, color: "var(--app-text)", marginBottom: 8 }}>Enquiry sent</div>
            <div style={{ fontSize: 13, color: "var(--app-text-3)", lineHeight: 1.6 }}>
              {partner.name} will respond within {partner.responseTime}.
              {userEmail && <><br />A confirmation has been sent to your email.</>}
            </div>
            <button onClick={onClose} style={{
              marginTop: 24, padding: "10px 24px", borderRadius: 8,
              background: "var(--teal)", color: "#fff", border: "none",
              fontSize: 13, fontWeight: 500, cursor: "pointer", fontFamily: "var(--font-inter), sans-serif",
            }}>
              Done
            </button>
          </div>
        ) : (
          <>
            {/* Form body */}
            <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px", display: "flex", flexDirection: "column", gap: 14 }}>

              {/* Drug — pre-filled, read-only */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 500, color: "var(--app-text-3)", marginBottom: 4 }}>Drug required</div>
                <div style={{
                  padding: "8px 10px", borderRadius: 8,
                  border: "1px solid var(--app-border)", fontSize: 12,
                  color: "var(--app-text)", background: "var(--app-bg-2)",
                }}>{drugName}</div>
              </div>

              {/* Quantity */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 500, color: "var(--app-text-3)", marginBottom: 4 }}>Quantity needed</div>
                <input
                  value={quantity}
                  onChange={e => setQuantity(e.target.value)}
                  placeholder="e.g. 200 units / month"
                  style={{
                    width: "100%", padding: "8px 10px", borderRadius: 8,
                    border: "1px solid var(--app-border)", fontSize: 12,
                    color: "var(--app-text)", background: "var(--app-bg)",
                    fontFamily: "var(--font-inter), sans-serif", outline: "none",
                    boxSizing: "border-box",
                  }}
                />
              </div>

              {/* Urgency */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 500, color: "var(--app-text-3)", marginBottom: 6 }}>Urgency</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
                  {["Routine", "Urgent", "Critical"].map(u => {
                    const active = urgency === u.toLowerCase();
                    return (
                      <button key={u} onClick={() => setUrgency(u.toLowerCase())} style={{
                        padding: "8px 4px", borderRadius: 8, fontSize: 12,
                        cursor: "pointer", fontFamily: "var(--font-inter), sans-serif",
                        border: `1px solid ${active ? "var(--teal-b)" : "var(--app-border)"}`,
                        background: active ? "var(--teal-bg)" : "var(--app-bg)",
                        color: active ? "var(--teal)" : "var(--app-text-3)",
                        fontWeight: active ? 500 : 400,
                      }}>
                        {u}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Organisation */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 500, color: "var(--app-text-3)", marginBottom: 4 }}>Organisation</div>
                <input
                  value={organisation}
                  onChange={e => setOrganisation(e.target.value)}
                  placeholder="Your pharmacy or hospital name"
                  style={{
                    width: "100%", padding: "8px 10px", borderRadius: 8,
                    border: "1px solid var(--app-border)", fontSize: 12,
                    color: "var(--app-text)", background: "var(--app-bg)",
                    fontFamily: "var(--font-inter), sans-serif", outline: "none",
                    boxSizing: "border-box",
                  }}
                />
              </div>

              {/* Message */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 500, color: "var(--app-text-3)", marginBottom: 4 }}>
                  Message <span style={{ color: "var(--app-text-4)", fontWeight: 400 }}>(optional)</span>
                </div>
                <textarea
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                  placeholder="Any additional context for the supplier..."
                  style={{
                    width: "100%", padding: "8px 10px", borderRadius: 8,
                    border: "1px solid var(--app-border)", fontSize: 12,
                    color: "var(--app-text)", background: "var(--app-bg)",
                    fontFamily: "var(--font-inter), sans-serif", height: 80, resize: "none", outline: "none",
                    boxSizing: "border-box",
                  }}
                />
              </div>

              {error && <div style={{ fontSize: 12, color: "var(--crit)" }}>{error}</div>}
            </div>

            {/* Footer */}
            <div style={{ padding: "14px 20px", borderTop: "1px solid var(--app-border)" }}>
              <button
                onClick={handleSubmit}
                disabled={submitting}
                style={{
                  width: "100%", padding: 13, borderRadius: 10,
                  background: submitting ? "var(--teal-l)" : "var(--teal)",
                  border: "none", color: "#fff",
                  fontSize: 14, fontWeight: 600,
                  cursor: submitting ? "not-allowed" : "pointer",
                  fontFamily: "var(--font-inter), sans-serif", marginBottom: 8,
                }}
              >
                {submitting ? "Sending..." : `Send enquiry to ${partner.name}`}
              </button>
              <div style={{ fontSize: 10, color: "var(--app-text-4)", textAlign: "center", lineHeight: 1.5 }}>
                {partner.name} will respond within {partner.responseTime} · Your details are shared only with this supplier
              </div>
            </div>
          </>
        )}
      </div>
    </>,
    document.body,
  );
}
