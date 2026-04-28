"use client";

import { useState } from "react";
import { X, Send, CheckCircle2 } from "lucide-react";
import QuoteCoaching from "./QuoteCoaching";

interface Enquiry {
  id: string;
  drug_name: string;
  quantity: string | null;
  urgency: string;
  organisation: string | null;
  country: string;
}

interface QuoteModalProps {
  enquiry: Enquiry;
  onClose: () => void;
  onSubmitted: () => void;
}

const CURRENCIES = ["AUD", "USD", "EUR", "GBP", "CAD", "JPY", "SGD", "CHF"];

export default function QuoteModal({ enquiry, onClose, onSubmitted }: QuoteModalProps) {
  const [unitPrice, setUnitPrice] = useState("");
  const [currency, setCurrency] = useState("AUD");
  const [availableQty, setAvailableQty] = useState("");
  const [moq, setMoq] = useState("");
  const [eta, setEta] = useState("");
  const [shippingTerms, setShippingTerms] = useState("");
  const [paymentTerms, setPaymentTerms] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/supplier/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enquiry_id: enquiry.id,
          quote_amount: unitPrice ? Number(unitPrice) : null,
          currency,
          available_quantity: availableQty || null,
          minimum_order_quantity: moq || null,
          delivery_eta: eta || null,
          shipping_terms: shippingTerms || null,
          payment_terms: paymentTerms || null,
          valid_until: validUntil || null,
          notes: notes || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to submit quote");
      } else {
        setSubmitted(true);
        setTimeout(() => onSubmitted(), 1500);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(15, 23, 42, 0.6)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 1000, padding: 20,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: "white", borderRadius: 14, maxWidth: 1080, width: "100%",
          maxHeight: "92vh", overflowY: "auto",
          boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
          display: "grid", gridTemplateColumns: submitted ? "1fr" : "1fr 320px",
        }}
      >
        {/* LEFT COLUMN — form */}
        <div>
        {/* Header */}
        <div style={{ padding: "20px 24px", borderBottom: "1px solid var(--app-border)", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--app-text-4)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>
              Submit quote
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "var(--app-text)" }}>{enquiry.drug_name}</div>
            <div style={{ fontSize: 12, color: "var(--app-text-4)", marginTop: 4 }}>
              {enquiry.organisation && <>{enquiry.organisation} · </>}
              {enquiry.country} · <span style={{ color: enquiry.urgency.toLowerCase() === "critical" ? "var(--crit)" : enquiry.urgency.toLowerCase() === "urgent" ? "var(--high)" : "var(--app-text-4)", fontWeight: 600 }}>{enquiry.urgency.toUpperCase()}</span>
              {enquiry.quantity && <> · needs {enquiry.quantity}</>}
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--app-text-4)", padding: 4 }}>
            <X size={18} />
          </button>
        </div>

        {submitted ? (
          <div style={{ padding: "60px 24px", textAlign: "center" }}>
            <CheckCircle2 size={48} color="var(--low)" style={{ margin: "0 auto 14px" }} />
            <div style={{ fontSize: 18, fontWeight: 700, color: "var(--app-text)" }}>Quote sent</div>
            <div style={{ fontSize: 13, color: "var(--app-text-4)", marginTop: 8 }}>
              Buyer notified by email. Track status in your Quotes pipeline.
            </div>
          </div>
        ) : (
          <>
            {/* Body */}
            <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
              {/* Price + currency */}
              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12 }}>
                <div>
                  <Label>Unit price</Label>
                  <input
                    type="number"
                    step="0.01"
                    value={unitPrice}
                    onChange={e => setUnitPrice(e.target.value)}
                    placeholder="0.00"
                    style={inputStyle}
                  />
                </div>
                <div>
                  <Label>Currency</Label>
                  <select value={currency} onChange={e => setCurrency(e.target.value)} style={inputStyle}>
                    {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>

              {/* Available qty + MOQ */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <Label>Available quantity</Label>
                  <input
                    type="text"
                    value={availableQty}
                    onChange={e => setAvailableQty(e.target.value)}
                    placeholder="e.g. 10,000 units"
                    style={inputStyle}
                  />
                </div>
                <div>
                  <Label>Minimum order qty</Label>
                  <input
                    type="text"
                    value={moq}
                    onChange={e => setMoq(e.target.value)}
                    placeholder="e.g. 1,000 units"
                    style={inputStyle}
                  />
                </div>
              </div>

              {/* ETA + valid until */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <Label>Delivery ETA</Label>
                  <input
                    type="text"
                    value={eta}
                    onChange={e => setEta(e.target.value)}
                    placeholder="e.g. 7-10 business days"
                    style={inputStyle}
                  />
                </div>
                <div>
                  <Label>Quote valid until</Label>
                  <input
                    type="date"
                    value={validUntil}
                    onChange={e => setValidUntil(e.target.value)}
                    style={inputStyle}
                  />
                </div>
              </div>

              {/* Shipping + payment */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <Label>Shipping terms</Label>
                  <input
                    type="text"
                    value={shippingTerms}
                    onChange={e => setShippingTerms(e.target.value)}
                    placeholder="e.g. CIF Sydney"
                    style={inputStyle}
                  />
                </div>
                <div>
                  <Label>Payment terms</Label>
                  <input
                    type="text"
                    value={paymentTerms}
                    onChange={e => setPaymentTerms(e.target.value)}
                    placeholder="e.g. Net 30"
                    style={inputStyle}
                  />
                </div>
              </div>

              {/* Notes */}
              <div>
                <Label>Notes</Label>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="Additional info, certifications, batch availability, etc."
                  rows={3}
                  style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }}
                />
              </div>

              {error && (
                <div style={{ padding: 10, background: "var(--crit-bg)", color: "var(--crit)", border: "1px solid var(--crit-b)", borderRadius: 6, fontSize: 13 }}>
                  {error}
                </div>
              )}
            </div>

            {/* Footer */}
            <div style={{ padding: "16px 24px", borderTop: "1px solid var(--app-border)", display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--app-bg)" }}>
              <div style={{ fontSize: 12, color: "var(--app-text-4)" }}>
                Buyer is notified by email immediately
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={onClose} style={{ padding: "10px 16px", fontSize: 13, fontWeight: 500, background: "white", color: "var(--app-text)", border: "1px solid var(--app-border)", borderRadius: 6, cursor: "pointer" }}>
                  Cancel
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={submitting}
                  style={{
                    padding: "10px 20px", fontSize: 13, fontWeight: 600,
                    background: "var(--teal)", color: "white", border: "none", borderRadius: 6,
                    cursor: submitting ? "wait" : "pointer",
                    display: "inline-flex", alignItems: "center", gap: 8,
                  }}
                >
                  <Send size={13} /> {submitting ? "Sending…" : "Submit quote"}
                </button>
              </div>
            </div>
          </>
        )}
        </div>
        {/* RIGHT COLUMN — AI Quote Coach (hidden on success state) */}
        {!submitted && (
          <aside style={{ background: "#0F172A", padding: 20, borderLeft: "1px solid var(--app-border)" }}>
            <QuoteCoaching enquiryId={enquiry.id} />
          </aside>
        )}
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 600, color: "var(--app-text-3)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.04em" }}>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  fontSize: 14,
  border: "1px solid var(--app-border)",
  borderRadius: 6,
  background: "white",
  color: "var(--app-text)",
  outline: "none",
  boxSizing: "border-box",
};
