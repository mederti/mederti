"use client";

import type { CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { useAutocomplete } from "@/lib/hooks/use-autocomplete";
import AutocompleteDropdown from "@/app/components/autocomplete-dropdown";

const SAMPLES = ["Amoxicillin 500mg", "Cisplatin", "Metformin", "Atorvastatin"];

// AutocompleteDropdown is styled with the shared app's --app-*/--high*/--teal/--crit-bg
// tokens. The V1 home defines a different palette (--ink/--green/--border/...), so map the
// dropdown's tokens onto it here — without this the dropdown renders with unresolved colors.
const DROPDOWN_TOKENS = {
  "--app-border": "var(--border)",
  "--app-text": "var(--text)",
  "--app-text-4": "var(--text-4)",
  "--app-bg": "var(--bg-2)",
  "--crit-bg": "#fff1f3",
  "--high-bg": "#fffbeb",
  "--high": "var(--med)",
  "--high-b": "var(--med-b)",
  "--teal": "var(--green-d)",
  position: "relative",
  maxWidth: 580,
  margin: "0 auto",
} as CSSProperties;

export default function V1Search() {
  const router = useRouter();

  function go(value: string) {
    const t = value.trim();
    if (!t) return;
    router.push(`/search?q=${encodeURIComponent(t)}`);
  }

  const ac = useAutocomplete({
    minChars: 2,
    onSelect: (item) => {
      ac.setIsOpen(false);
      router.push(item.href);
    },
    onSubmit: go,
  });

  return (
    <>
      <div ref={ac.containerRef} style={DROPDOWN_TOKENS}>
        <div className="searchbox">
          <span className="ic">⌕</span>
          <input
            autoFocus
            placeholder="Search a drug — e.g. amoxicillin, cisplatin, metformin"
            {...ac.inputProps}
          />
          <button onClick={() => go(ac.query)}>Search</button>
        </div>
        {ac.isOpen && (
          <AutocompleteDropdown
            items={ac.items}
            cursor={ac.cursor}
            loading={ac.loading}
            query={ac.query}
            listId={ac.inputProps["aria-controls"]}
            onSelect={(item) => {
              ac.setIsOpen(false);
              router.push(item.href);
            }}
            onHover={() => {}}
          />
        )}
      </div>
      <div className="samples">
        {SAMPLES.map((s) => (
          <button key={s} className="sample" onClick={() => go(s)}>
            {s}
          </button>
        ))}
      </div>
    </>
  );
}
