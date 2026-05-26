"use client";

import { useEffect, useRef, useState } from "react";
import type { LeadInput, LeadResponse, LeadType } from "@/lib/chat/types";

const TITLES: Record<LeadType, string> = {
  pre_order: "Pre-order this drug",
  forward_order: "Forward order",
  supplier_interest: "Express supply interest",
  order: "Order via this supplier",
};

const SUBTITLES: Record<LeadType, string> = {
  pre_order:
    "We'll match you with a verified supplier when stock returns. No commitment — we contact you first.",
  forward_order:
    "Receive committed delivery quotes from verified wholesalers when stock returns. Institutional volumes welcome.",
  supplier_interest:
    "Tell us you can fulfil this demand. We'll connect you with matched buyers.",
  order:
    "We'll connect you with this supplier directly. Mederti handles the introduction.",
};

const CTA: Record<LeadType, string> = {
  pre_order: "Pre-order",
  forward_order: "Submit forward order",
  supplier_interest: "Express interest",
  order: "Request order",
};

export type LeadIntent = Omit<LeadInput, "contact_email" | "contact_name" | "company_name" | "volume_estimate"> & {
  notes?: string;
};

export function LeadCaptureModal({
  intent,
  open,
  onClose,
}: {
  intent: LeadIntent | null;
  open: boolean;
  onClose: () => void;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [volume, setVolume] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<LeadResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  // Reset on open.
  useEffect(() => {
    if (open) {
      setDone(null);
      setErr(null);
      setTimeout(() => emailRef.current?.focus(), 50);
    }
  }, [open, intent?.lead_type]);

  // Escape closes.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open || !intent) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!intent) return;
    if (!email || submitting) return;
    setSubmitting(true);
    setErr(null);
    try {
      const payload: LeadInput = {
        ...intent,
        contact_email: email.trim(),
        contact_name: name.trim() || undefined,
        company_name: company.trim() || undefined,
        volume_estimate: volume.trim() || undefined,
        notes: notes.trim() || undefined,
      };
      const resp = await fetch("/api/lead", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await resp.json()) as LeadResponse;
      if (!resp.ok || !data.ok) {
        setErr(data.error || `Failed (${resp.status})`);
      } else {
        setDone(data);
      }
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : String(e2));
    } finally {
      setSubmitting(false);
    }
  }

  const isOrder = intent.lead_type === "order";
  const isSupplier = intent.lead_type === "supplier_interest";

  return (
    <>
      <div className="modal-backdrop" onClick={onClose} />
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="lead-title">
        <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M2 2L12 12M12 2L2 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>

        {done ? (
          <div className="modal-success">
            <div className="modal-success-icon">✓</div>
            <h2 id="lead-title" className="modal-title">You're on the list.</h2>
            <p className="modal-sub">
              Mederti has your request{intent.drug_name ? ` for ${intent.drug_name}` : ""}. We'll reach out at <strong>{email}</strong>{" "}
              within one business day.
            </p>
            {!done.persisted ? (
              <p className="modal-warn">
                (Note for the operator: the leads table isn't migrated yet — your request was logged but not saved to the DB. Paste{" "}
                <code>supabase/migrations/0001_leads.sql</code> into the Supabase SQL editor.)
              </p>
            ) : null}
            <button type="button" className="composer-send modal-done-btn" onClick={onClose}>Done</button>
          </div>
        ) : (
          <form onSubmit={submit}>
            <div className="modal-head">
              <h2 id="lead-title" className="modal-title">{TITLES[intent.lead_type]}</h2>
              <p className="modal-sub">{SUBTITLES[intent.lead_type]}</p>
            </div>

            <div className="modal-ctx">
              {intent.drug_name ? <div><span className="modal-ctx-label">Drug</span> {intent.drug_name}</div> : null}
              {intent.alternative_drug_name ? <div><span className="modal-ctx-label">Substitute</span> {intent.alternative_drug_name}</div> : null}
              {intent.supplier_name ? <div><span className="modal-ctx-label">Supplier</span> {intent.supplier_name}</div> : null}
              {intent.country_code ? <div><span className="modal-ctx-label">Country</span> {intent.country_code}</div> : null}
            </div>

            <div className="modal-fields">
              <label className="modal-field">
                <span className="modal-field-label">Email <span className="modal-req">*</span></span>
                <input
                  ref={emailRef}
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="modal-input"
                />
              </label>
              <div className="modal-row">
                <label className="modal-field">
                  <span className="modal-field-label">Your name</span>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Optional"
                    className="modal-input"
                  />
                </label>
                <label className="modal-field">
                  <span className="modal-field-label">{isSupplier ? "Company" : "Pharmacy / institution"}</span>
                  <input
                    type="text"
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                    placeholder="Optional"
                    className="modal-input"
                  />
                </label>
              </div>
              {!isOrder ? (
                <label className="modal-field">
                  <span className="modal-field-label">{isSupplier ? "Available volume / coverage" : "Estimated volume"}</span>
                  <input
                    type="text"
                    value={volume}
                    onChange={(e) => setVolume(e.target.value)}
                    placeholder={isSupplier ? "e.g. 50,000 units/quarter, AU+NZ" : "e.g. 500 packs/month"}
                    className="modal-input"
                  />
                </label>
              ) : null}
              <label className="modal-field">
                <span className="modal-field-label">Notes</span>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Anything else we should know?"
                  className="modal-input modal-textarea"
                  rows={2}
                />
              </label>
            </div>

            {err ? <div className="err">{err}</div> : null}

            <div className="modal-actions">
              <button type="button" className="modal-cancel" onClick={onClose} disabled={submitting}>
                Cancel
              </button>
              <button type="submit" className="modal-submit" disabled={submitting || !email}>
                {submitting ? "Sending…" : CTA[intent.lead_type]}
              </button>
            </div>
            <p className="modal-foot">
              No commitment. Mederti will introduce you — we don't share your email with suppliers without confirmation.
            </p>
          </form>
        )}
      </div>
    </>
  );
}
