"use client";

import { useState } from "react";

export default function NewsletterForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setStatus("loading");
    try {
      const res = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, source: "intelligence_newsletter" }),
      });
      if (res.ok) {
        setStatus("success");
        setEmail("");
      } else {
        setStatus("error");
      }
    } catch {
      setStatus("error");
    }
  }

  return (
    <div style={{
      background: "#0f172a",
      padding: "64px 32px",
    }}>
      <div style={{
        maxWidth: 560, margin: "0 auto", textAlign: "center",
      }}>
        <div style={{
          fontSize: 11, fontWeight: 600, letterSpacing: "0.12em",
          textTransform: "uppercase", color: "var(--teal)",
          marginBottom: 16,
        }}>
          Newsletter
        </div>
        <div style={{
          fontSize: "clamp(22px, 3vw, 28px)", fontWeight: 650,
          color: "#fff", lineHeight: 1.3,
          marginBottom: 12,
        }}>
          Get the Mederti Intelligence briefing every Monday.
        </div>
        <p style={{
          fontSize: 14, color: "rgba(255,255,255,0.4)",
          lineHeight: 1.6, margin: "0 0 28px",
        }}>
          Shortage alerts, new data releases and analysis — one concise email per week.
        </p>

        {status === "success" ? (
          <div style={{
            padding: "14px 20px", borderRadius: 8,
            background: "rgba(15,23,42,0.15)",
            border: "1px solid rgba(15,23,42,0.3)",
            color: "var(--teal)", fontSize: 14, fontWeight: 500,
          }}>
            You&apos;re subscribed. Check your inbox.
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="intel-newsletter-form" style={{
              display: "flex", gap: 10,
              justifyContent: "center",
            }}>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="you@hospital.org"
                style={{
                  width: 280, padding: "12px 16px",
                  borderRadius: 6, border: "1px solid rgba(255,255,255,0.15)",
                  background: "rgba(255,255,255,0.06)",
                  color: "#fff", fontSize: 14,
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
              <button
                type="submit"
                disabled={status === "loading"}
                style={{
                  padding: "12px 24px", borderRadius: 6,
                  border: "none",
                  background: status === "loading" ? "rgba(15,23,42,0.5)" : "var(--teal)",
                  color: "#fff", fontSize: 14, fontWeight: 600,
                  cursor: status === "loading" ? "not-allowed" : "pointer",
                }}
              >
                {status === "loading" ? "Subscribing..." : "Subscribe"}
              </button>
            </div>
            {status === "error" && (
              <div style={{ fontSize: 13, color: "#ef4444", marginTop: 12 }}>
                Something went wrong. Please try again.
              </div>
            )}
          </form>
        )}

        <div style={{
          fontSize: 12, color: "rgba(255,255,255,0.25)",
          marginTop: 16,
        }}>
          No spam. Unsubscribe anytime.
        </div>
      </div>
    </div>
  );
}
