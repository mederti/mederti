"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search, X, Loader2 } from "lucide-react";
import { useAutocomplete } from "@/lib/hooks/use-autocomplete";
import AutocompleteDropdown from "@/app/components/autocomplete-dropdown";

export default function MedicineSearch() {
  const router = useRouter();
  const [focused, setFocused] = useState(false);

  const ac = useAutocomplete({
    minChars: 2,
    debounceMs: 200,
    limit: 8,
    onSelect: (item) => router.push(item.href),
  });

  return (
    <div
      ref={ac.containerRef}
      style={{
        background: "#fff",
        border: "1px solid #e8ecf0",
        borderRadius: 12,
        overflow: "visible",
        padding: "10px 16px",
        position: "relative",
        display: "flex",
        alignItems: "center",
        gap: 12,
      }}
    >
      {/* Label */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: 7,
            background: "rgba(15,23,42,0.1)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Search
            style={{ width: 14, height: 14, strokeWidth: 1.5 }}
            color="#0c1118"
          />
        </div>
        <span
          style={{ fontSize: 13, fontWeight: 600, color: "#0c1118", whiteSpace: "nowrap" }}
        >
          Medicine Search
        </span>
      </div>

      {/* Search input */}
      <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
        <Search
          style={{
            position: "absolute",
            left: 12,
            top: "50%",
            transform: "translateY(-50%)",
            width: 15,
            height: 15,
            strokeWidth: 1.5,
            color: "#98a1ac",
            pointerEvents: "none",
          }}
        />
        <input
          type="text"
          {...ac.inputProps}
          onFocus={() => { ac.inputProps.onFocus(); setFocused(true); }}
          onBlur={() => setFocused(false)}
          placeholder="Search by drug name or active ingredient…"
          style={{
            width: "100%",
            padding: "9px 36px 9px 36px",
            borderRadius: 8,
            border: `1.5px solid ${focused ? "#0c1118" : "#e8ecf0"}`,
            fontSize: 14,
            color: "#0c1118",
            background: "#fafbfc",
            outline: "none",
            fontFamily: "var(--font-inter), sans-serif",
            boxSizing: "border-box",
            transition: "border-color 0.15s",
          }}
        />
        {ac.query && (
          <button
            onClick={() => ac.clear()}
            style={{
              position: "absolute",
              right: 10,
              top: "50%",
              transform: "translateY(-50%)",
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: 2,
              display: "flex",
              alignItems: "center",
            }}
          >
            <X
              style={{ width: 14, height: 14, strokeWidth: 1.5 }}
              color="#98a1ac"
            />
          </button>
        )}
        {ac.loading && (
          <Loader2
            style={{
              position: "absolute",
              right: ac.query ? 30 : 10,
              top: "50%",
              transform: "translateY(-50%)",
              width: 14,
              height: 14,
              strokeWidth: 2,
              color: "#0c1118",
              animation: "spin 1s linear infinite",
            }}
          />
        )}
      </div>

      {/* Autocomplete dropdown */}
      {ac.isOpen && (
        <AutocompleteDropdown
          items={ac.items}
          cursor={ac.cursor}
          loading={ac.loading}
          query={ac.query}
          listId={ac.inputProps["aria-controls"]}
          onSelect={(item) => { ac.setIsOpen(false); router.push(item.href); }}
          onHover={() => {}}
        />
      )}

      <style>{`
        @keyframes spin { to { transform: translateY(-50%) rotate(360deg); } }
      `}</style>
    </div>
  );
}
