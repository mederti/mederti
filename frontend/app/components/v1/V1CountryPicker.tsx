"use client";

import { useEffect, useRef, useState } from "react";

// Markets we carry regulator shortage data for.
const COUNTRIES: { code: string; name: string; flag: string }[] = [
  { code: "AU", name: "Australia", flag: "🇦🇺" },
  { code: "US", name: "United States", flag: "🇺🇸" },
  { code: "GB", name: "United Kingdom", flag: "🇬🇧" },
  { code: "CA", name: "Canada", flag: "🇨🇦" },
  { code: "NZ", name: "New Zealand", flag: "🇳🇿" },
  { code: "IE", name: "Ireland", flag: "🇮🇪" },
  { code: "DE", name: "Germany", flag: "🇩🇪" },
  { code: "FR", name: "France", flag: "🇫🇷" },
  { code: "IT", name: "Italy", flag: "🇮🇹" },
  { code: "ES", name: "Spain", flag: "🇪🇸" },
  { code: "CH", name: "Switzerland", flag: "🇨🇭" },
  { code: "NL", name: "Netherlands", flag: "🇳🇱" },
  { code: "SE", name: "Sweden", flag: "🇸🇪" },
  { code: "NO", name: "Norway", flag: "🇳🇴" },
  { code: "FI", name: "Finland", flag: "🇫🇮" },
  { code: "DK", name: "Denmark", flag: "🇩🇰" },
];

export default function V1CountryPicker() {
  const [code, setCode] = useState("AU");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const m = document.cookie.match(/(?:^|; )mederti-country=([A-Za-z]{2})/);
    if (m) setCode(m[1].toUpperCase());
  }, []);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  function pick(c: string) {
    document.cookie = `mederti-country=${c};path=/;max-age=${60 * 60 * 24 * 365}`;
    setOpen(false);
    // Full reload so server components re-render with the new market.
    window.location.reload();
  }

  const cur = COUNTRIES.find((c) => c.code === code) ?? COUNTRIES[0];

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Choose your market"
        style={{
          display: "inline-flex", alignItems: "center", gap: 7,
          padding: "8px 12px", borderRadius: 10,
          border: "1px solid var(--border)", background: "var(--bg)",
          fontSize: 13, fontWeight: 600, color: "var(--text-2)", cursor: "pointer",
          fontFamily: "inherit",
        }}
      >
        <span style={{ fontSize: 15 }}>{cur.flag}</span>
        {cur.name}
        <span style={{ fontSize: 9, color: "var(--text-4)" }}>▾</span>
      </button>

      {open && (
        <div
          style={{
            position: "absolute", bottom: "calc(100% + 6px)", left: 0, zIndex: 100,
            background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 12,
            boxShadow: "0 20px 50px -20px rgba(10,15,26,.3)", padding: 6,
            width: 200, maxHeight: 320, overflowY: "auto",
          }}
        >
          <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--text-4)", padding: "6px 10px 4px" }}>
            Your market
          </div>
          {COUNTRIES.map((c) => (
            <button
              key={c.code}
              type="button"
              onClick={() => pick(c.code)}
              style={{
                display: "flex", alignItems: "center", gap: 10, width: "100%",
                padding: "9px 10px", borderRadius: 8, border: "none", cursor: "pointer",
                fontSize: 13, fontFamily: "inherit", textAlign: "left",
                background: c.code === cur.code ? "var(--green-bg)" : "transparent",
                color: c.code === cur.code ? "var(--green-d)" : "var(--text-2)",
                fontWeight: c.code === cur.code ? 600 : 500,
              }}
              onMouseEnter={(e) => { if (c.code !== cur.code) (e.currentTarget as HTMLElement).style.background = "var(--bg-2)"; }}
              onMouseLeave={(e) => { if (c.code !== cur.code) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
            >
              <span style={{ fontSize: 16 }}>{c.flag}</span>
              {c.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
