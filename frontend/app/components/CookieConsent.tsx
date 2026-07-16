"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  OPEN_PREFERENCES_EVENT,
  readConsent,
  writeConsent,
  type ConsentValue,
} from "@/lib/consent";

/**
 * GDPR/ePrivacy consent banner for optional analytics cookies (PostHog).
 *
 * Shows on first visit (no stored choice) and whenever a "Cookie preferences"
 * link fires OPEN_PREFERENCES_EVENT. Accept and Decline are equal-prominence
 * buttons — no pre-ticked boxes, no buried reject. Essential cookies (login
 * session, country preference) are not gated; they run regardless, as allowed.
 */
export default function CookieConsent() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const reopen = () => setOpen(true);
    // Deferred so the banner appears after hydration settles (and to keep the
    // effect body free of synchronous setState).
    const id = window.setTimeout(() => {
      if (readConsent() === null) reopen();
    }, 0);
    window.addEventListener(OPEN_PREFERENCES_EVENT, reopen);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener(OPEN_PREFERENCES_EVENT, reopen);
    };
  }, []);

  if (!open) return null;

  const choose = (value: ConsentValue) => {
    writeConsent(value);
    setOpen(false);
  };

  const buttonBase: React.CSSProperties = {
    flex: 1,
    padding: "9px 16px",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    fontFamily: "inherit",
    cursor: "pointer",
    lineHeight: 1.2,
  };

  return (
    <div
      role="dialog"
      aria-label="Cookie consent"
      style={{
        position: "fixed",
        bottom: 20,
        left: 20,
        zIndex: 1000,
        maxWidth: 400,
        width: "calc(100vw - 40px)",
        background: "var(--app-bg, #fff)",
        border: "1px solid var(--app-border, #e5e7eb)",
        borderRadius: 12,
        boxShadow: "0 8px 30px rgba(10, 30, 40, 0.12)",
        padding: 20,
        fontFamily: "var(--font-geist-sans), sans-serif",
      }}
    >
      <div style={{ fontSize: 14, fontWeight: 600, color: "var(--app-text, #111)", marginBottom: 6 }}>
        Cookies on Mederti
      </div>
      <p style={{ fontSize: 13, lineHeight: 1.6, color: "var(--app-text-3, #555)", margin: "0 0 14px" }}>
        We&apos;d like to use optional analytics cookies (PostHog, EU-hosted) to understand how
        the product is used. Essential cookies — login and your country preference — are always
        on. See our{" "}
        <Link href="/privacy" style={{ color: "var(--teal, #0fa676)", textDecoration: "none" }}>
          Privacy Policy
        </Link>
        .
      </p>
      <div style={{ display: "flex", gap: 10 }}>
        <button
          onClick={() => choose("denied")}
          style={{
            ...buttonBase,
            background: "transparent",
            border: "1px solid var(--app-border, #d1d5db)",
            color: "var(--app-text-2, #333)",
          }}
        >
          Decline
        </button>
        <button
          onClick={() => choose("granted")}
          style={{
            ...buttonBase,
            background: "var(--teal, #0fa676)",
            border: "1px solid var(--teal, #0fa676)",
            color: "#fff",
          }}
        >
          Accept analytics
        </button>
      </div>
    </div>
  );
}
