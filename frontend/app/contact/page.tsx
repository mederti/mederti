"use client";

import SiteNav from "@/app/components/landing-nav";
import MinimalFooter from "@/app/components/minimal-footer";
import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

function ContactForm() {
  const params = useSearchParams();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState("");

  useEffect(() => {
    const s = params.get("subject");
    if (s) setSubject(decodeURIComponent(s));
  }, [params]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setError("");
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, subject, message }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Something went wrong.");
        setStatus("error");
      } else {
        setStatus("sent");
      }
    } catch {
      setError("Network error — please try again.");
      setStatus("error");
    }
  }

  const inputStyle = {
    width: "100%", padding: "10px 12px", borderRadius: 8,
    border: "1px solid var(--app-border)", fontSize: 14,
    fontFamily: "var(--font-inter), sans-serif",
    outline: "none", boxSizing: "border-box" as const,
    background: "#fff", color: "var(--app-text)",
  };
  const labelStyle = {
    fontSize: 12, fontWeight: 500 as const, color: "var(--app-text-3)",
    display: "block" as const, marginBottom: 6,
  };

  if (status === "sent") {
    return (
      <div style={{
        background: "var(--low-bg)", border: "1px solid var(--low-b)",
        borderRadius: 12, padding: "32px 28px", textAlign: "center",
      }}>
        <div style={{ fontSize: 28, marginBottom: 12 }}>✓</div>
        <div style={{ fontSize: 16, fontWeight: 600, color: "var(--low)", marginBottom: 8 }}>Message sent</div>
        <div style={{ fontSize: 14, color: "var(--app-text-3)", lineHeight: 1.65 }}>
          We&apos;ll get back to you at <strong>{email}</strong> within 24–48 hours.
        </div>
        <button
          onClick={() => { setStatus("idle"); setName(""); setEmail(""); setSubject(""); setMessage(""); }}
          style={{ marginTop: 20, fontSize: 13, color: "var(--teal)", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}
        >
          Send another message
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }} className="contact-form-row">
        <div>
          <label style={labelStyle}>Name</label>
          <input style={inputStyle} value={name} onChange={e => setName(e.target.value)} placeholder="Your name" required />
        </div>
        <div>
          <label style={labelStyle}>Email</label>
          <input style={inputStyle} type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" required />
        </div>
      </div>
      <div>
        <label style={labelStyle}>Subject <span style={{ color: "var(--app-text-4)", fontWeight: 400 }}>(optional)</span></label>
        <input style={inputStyle} value={subject} onChange={e => setSubject(e.target.value)} placeholder="e.g. Pro plan enquiry, data correction, partnership" />
      </div>
      <div>
        <label style={labelStyle}>Message</label>
        <textarea
          style={{ ...inputStyle, resize: "vertical", minHeight: 140, lineHeight: 1.65 }}
          value={message}
          onChange={e => setMessage(e.target.value)}
          placeholder="Tell us what you need…"
          required
        />
      </div>

      {status === "error" && (
        <div style={{ background: "var(--crit-bg)", border: "1px solid var(--crit-b)", color: "var(--crit)", borderRadius: 8, padding: "10px 14px", fontSize: 13 }}>
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={status === "sending"}
        style={{
          padding: "12px 24px", borderRadius: 8, fontSize: 14, fontWeight: 600,
          background: status === "sending" ? "var(--app-bg-2)" : "var(--teal)",
          color: status === "sending" ? "var(--app-text-4)" : "#fff",
          border: "none", cursor: status === "sending" ? "not-allowed" : "pointer",
          fontFamily: "var(--font-inter), sans-serif",
          alignSelf: "flex-start",
        }}
      >
        {status === "sending" ? "Sending…" : "Send message →"}
      </button>
    </form>
  );
}

export default function ContactPage() {
  return (
    <div style={{ background: "#fff", minHeight: "100vh", color: "var(--app-text)", fontFamily: "var(--font-inter), sans-serif" }}>
      <style>{`
        @media (max-width: 768px) {
          .contact-layout { padding: 60px 20px 0 !important; }
          .contact-form-row { grid-template-columns: 1fr !important; }
        }
      `}</style>

      <SiteNav />

      <div className="contact-layout" style={{ maxWidth: 600, margin: "0 auto", padding: "80px 24px 0" }}>
        <h1 style={{ fontSize: 36, fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1.1, color: "var(--app-text)", margin: "0 0 16px" }}>
          Get in touch
        </h1>
        <p style={{ fontSize: 15, color: "var(--app-text-3)", lineHeight: 1.7, margin: "0 0 36px" }}>
          Questions about data accuracy, pricing, partnerships, or a correction to a shortage
          record — email{" "}
          <a href="mailto:hello@mederti.com" style={{ color: "var(--teal)", textDecoration: "none" }}>hello@mederti.com</a>{" "}
          or use the form below. We read every message and typically reply within 24 hours.
        </p>

        <Suspense fallback={<div style={{ height: 300, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--app-text-4)", fontSize: 14 }}>Loading…</div>}>
          <ContactForm />
        </Suspense>
      </div>

      <MinimalFooter />
    </div>
  );
}
