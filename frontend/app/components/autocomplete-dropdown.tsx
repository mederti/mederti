"use client";

import type { AutocompleteItem } from "@/lib/hooks/use-autocomplete";

const SEV_STYLE: Record<string, { label: string; bg: string; color: string; border: string }> = {
  critical: { label: "CRITICAL", bg: "var(--crit-bg)", color: "var(--crit)", border: "var(--crit-b)" },
  high:     { label: "HIGH",     bg: "var(--high-bg)", color: "var(--high)", border: "var(--high-b)" },
  active:   { label: "ACTIVE",   bg: "rgba(13,148,136,0.08)", color: "var(--teal)", border: "rgba(13,148,136,0.2)" },
};

function SeverityBadge({ severity }: { severity: string }) {
  const s = SEV_STYLE[severity] ?? SEV_STYLE.active;
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 4,
      background: s.bg, color: s.color, border: `1px solid ${s.border}`,
      whiteSpace: "nowrap", letterSpacing: "0.04em",
    }}>
      {s.label}
    </span>
  );
}

export interface AutocompleteDropdownProps {
  items: AutocompleteItem[];
  cursor: number;
  loading: boolean;
  query: string;
  listId: string;
  onSelect: (item: AutocompleteItem) => void;
  onHover: (index: number) => void;
}

export default function AutocompleteDropdown({
  items, cursor, loading, query, listId, onSelect, onHover,
}: AutocompleteDropdownProps) {
  if (!loading && items.length === 0 && query.length >= 2) {
    return (
      <div style={{
        position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0, zIndex: 200,
        background: "#fff", border: "1px solid var(--app-border)", borderRadius: 10,
        boxShadow: "0 8px 32px rgba(15,23,42,0.12)", overflow: "hidden",
      }}>
        <div style={{ padding: "16px", fontSize: 13, color: "var(--app-text-4)" }}>
          No drugs matched &ldquo;{query}&rdquo;
        </div>
      </div>
    );
  }

  if (items.length === 0) return null;

  return (
    <div
      role="listbox"
      id={listId}
      style={{
        position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0, zIndex: 200,
        background: "#fff", border: "1px solid var(--app-border)", borderRadius: 10,
        boxShadow: "0 8px 32px rgba(15,23,42,0.12)", overflow: "hidden",
      }}
    >
      {items.map((item, i) => (
        <div
          key={`${item.type}-${item.id}`}
          id={`${listId}-option-${i}`}
          role="option"
          aria-selected={cursor === i}
          onMouseDown={(e) => { e.preventDefault(); onSelect(item); }}
          onMouseEnter={() => onHover(i)}
          style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "10px 16px", minHeight: 44,
            background: cursor === i ? "var(--app-bg)" : "#fff",
            cursor: "pointer",
            borderBottom: i < items.length - 1 ? "1px solid var(--app-border)" : "none",
            transition: "background 0.08s",
          }}
        >
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{
              fontSize: 14, fontWeight: 500, color: "var(--app-text)",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {item.name}
              {item.strength && (
                <span style={{ fontWeight: 400 }}> {item.strength}</span>
              )}
            </div>
            {item.form && (
              <div style={{ fontSize: 12, color: "var(--app-text-4)", marginTop: 1 }}>
                {item.form}
              </div>
            )}
          </div>

          {item.severity && (
            <div style={{ flexShrink: 0, marginLeft: 12 }}>
              <SeverityBadge severity={item.severity} />
            </div>
          )}
        </div>
      ))}

      {/* Keyboard hints */}
      <div style={{
        padding: "8px 16px", fontSize: 11, color: "var(--app-text-4)",
        borderTop: "1px solid var(--app-border)", background: "var(--app-bg)",
        display: "flex", gap: 16,
      }}>
        <span>↵ select</span>
        <span>↑↓ navigate</span>
        <span>esc close</span>
      </div>
    </div>
  );
}
