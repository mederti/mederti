"use client";

import { useState } from "react";

interface EmailCaptureProps {
  placeholder?: string;
  btnText?: string;
  source?: string;
  small?: boolean;
}

export function EmailCapture({
  placeholder = "Enter your work email",
  btnText = "Get early access →",
  source = "landing_page",
  small = false,
}: EmailCaptureProps) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email) return;
    setState("loading");
    try {
      const res = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, source }),
      });
      if (res.ok) {
        setState("done");
        setEmail("");
      } else {
        setState("error");
      }
    } catch {
      setState("error");
    }
  }

  if (state === "done") {
    return (
      <p style={{ fontSize: small ? 13 : 14, color: "var(--teal)", fontWeight: 500 }}>
        ✓ You&apos;re on the list — we&apos;ll be in touch soon.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", gap: 10, maxWidth: small ? 360 : 480 }}>
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder={placeholder}
        required
        disabled={state === "loading"}
        style={{
          flex: 1,
          padding: small ? "11px 14px" : "13px 16px",
          borderRadius: 8,
          border: "1px solid var(--app-border-2)",
          background: "#fff",
          color: "var(--app-text)",
          fontSize: small ? 13 : 14,
          fontFamily: "var(--font-inter), sans-serif",
          outline: "none",
        }}
      />
      <button
        type="submit"
        disabled={state === "loading"}
        style={{
          padding: small ? "11px 18px" : "13px 22px",
          background: "var(--teal)",
          border: "none",
          borderRadius: 8,
          color: "#fff",
          fontSize: small ? 13 : 14,
          fontWeight: 600,
          fontFamily: "var(--font-inter), sans-serif",
          cursor: state === "loading" ? "wait" : "pointer",
          whiteSpace: "nowrap",
          opacity: state === "loading" ? 0.7 : 1,
        }}
      >
        {state === "loading" ? "Sending…" : btnText}
      </button>
      {state === "error" && (
        <span style={{ fontSize: 12, color: "var(--crit)", alignSelf: "center" }}>
          Try again
        </span>
      )}
    </form>
  );
}
