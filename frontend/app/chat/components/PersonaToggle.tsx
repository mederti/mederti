"use client";

import type { Persona } from "@/lib/chat/types";

const LABELS: Record<Persona, string> = {
  pharmacist: "Pharmacist",
  procurement: "Procurement",
  supplier: "Supplier",
};

export function PersonaToggle({
  value,
  onChange,
  disabled,
}: {
  value: Persona;
  onChange: (p: Persona) => void;
  disabled?: Persona[]; // e.g. ["supplier"] when drug is available
}) {
  const opts: Persona[] = ["pharmacist", "procurement", "supplier"];
  return (
    <div className="persona-toggle" role="tablist" aria-label="Persona view">
      {opts.map((p) => {
        const isOff = disabled?.includes(p) ?? false;
        const isOn = value === p && !isOff;
        return (
          <button
            key={p}
            type="button"
            role="tab"
            aria-selected={isOn}
            disabled={isOff}
            className={`persona-toggle-btn${isOn ? " persona-toggle-btn-on" : ""}`}
            onClick={() => !isOff && onChange(p)}
            title={isOff ? "Not applicable for this drug" : undefined}
          >
            {LABELS[p]}
          </button>
        );
      })}
    </div>
  );
}

const STORAGE_KEY = "mederti.chat.persona";
export function readStoredPersona(): Persona {
  if (typeof window === "undefined") return "pharmacist";
  const v = window.localStorage.getItem(STORAGE_KEY);
  if (v === "pharmacist" || v === "procurement" || v === "supplier") return v;
  return "pharmacist";
}
export function writeStoredPersona(p: Persona) {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(STORAGE_KEY, p); } catch { /* ignore quota */ }
}
