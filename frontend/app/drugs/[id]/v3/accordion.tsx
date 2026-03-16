"use client";

import { useState, type ReactNode } from "react";

interface AccordionProps {
  title: string;
  count?: number;
  defaultOpen?: boolean;
  children: ReactNode;
}

export default function Accordion({ title, count, defaultOpen = false, children }: AccordionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div style={{
      background: "#fff",
      border: "1px solid var(--app-border)",
      borderRadius: 10,
      overflow: "hidden",
    }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 18px",
          background: "none",
          border: "none",
          borderBottom: open ? "1px solid var(--app-border)" : "none",
          cursor: "pointer",
          fontFamily: "var(--font-inter), sans-serif",
        }}
      >
        <span style={{
          fontSize: 11,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.07em",
          color: "var(--app-text-3)",
        }}>
          {title}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {count != null && (
            <span style={{
              fontSize: 11,
              color: "var(--app-text-4)",
              fontFamily: "var(--font-dm-mono), monospace",
            }}>
              {count}
            </span>
          )}
          <span style={{
            fontSize: 14,
            color: "var(--app-text-4)",
            transition: "transform 0.2s",
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
            display: "inline-block",
          }}>
            {"\u25BE"}
          </span>
        </div>
      </button>
      {open && (
        <div style={{ padding: "16px 18px" }}>
          {children}
        </div>
      )}
    </div>
  );
}
