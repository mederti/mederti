/**
 * PersonaSwitcher — three-way pill bar shown above the drug page.
 *
 * Routing logic:
 *   • pharmacist     → stays on /drugs/[id]                    (the live React page)
 *   • procurement    → /design/procurement (static mockup of D · KPI dashboard)
 *   • supplier       → /design/supplier    (static mockup of F · Modular tiles)
 *
 * Future: read `user_profiles.role` from session and set the active pill
 * automatically; route mockup users to the matching live page once the
 * other two personas have shipped real React components.
 */
import Link from "next/link";

type Persona = "pharmacist" | "procurement" | "supplier";

interface Props {
  /** Currently viewed persona — controls which pill is highlighted. */
  current?: Persona;
  /** Drug id, in case we want to deep-link the procurement/supplier mockups
   *  back to the same drug context once they're real React pages. */
  drugId?: string;
}

const PERSONAS: Array<{
  key: Persona;
  label: string;
  sub: string;
  href: (drugId?: string) => string;
}> = [
  {
    key: "pharmacist",
    label: "Pharmacist",
    sub: "Action-first",
    href: (id) => (id ? `/drugs/${id}` : "/search"),
  },
  {
    key: "procurement",
    label: "Procurement",
    sub: "Numbers-first",
    href: () => "/design/procurement",
  },
  {
    key: "supplier",
    label: "Supplier",
    sub: "Market-scan",
    href: () => "/design/supplier",
  },
];

export default function PersonaSwitcher({ current = "pharmacist", drugId }: Props) {
  return (
    <div
      style={{
        background: "#ffffff",
        borderBottom: "1px solid #e2e8f0",
        padding: "10px 24px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        flexShrink: 0,
        flexWrap: "wrap",
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: "#94a3b8",
        }}
      >
        Viewing as
      </div>

      <div
        style={{
          display: "flex",
          gap: 4,
          background: "#f8fafc",
          padding: 4,
          borderRadius: 10,
          border: "1px solid #e2e8f0",
        }}
      >
        {PERSONAS.map((p) => {
          const active = p.key === current;
          return (
            <Link
              key={p.key}
              href={p.href(drugId)}
              prefetch={false}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-start",
                gap: 1,
                padding: "8px 14px",
                borderRadius: 7,
                background: active ? "#0F172A" : "transparent",
                color: active ? "#ffffff" : "#64748b",
                fontSize: 13,
                fontWeight: 500,
                textDecoration: "none",
                transition: "all 0.15s",
                minWidth: 110,
              }}
            >
              <span style={{ fontWeight: 600 }}>{p.label}</span>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 500,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                  opacity: active ? 0.7 : 0.6,
                }}
              >
                {p.sub}
              </span>
            </Link>
          );
        })}
      </div>

      <div
        style={{
          fontSize: 11,
          color: "#64748b",
          fontFamily: "monospace",
        }}
      >
        Same data · different emphasis
      </div>
    </div>
  );
}
