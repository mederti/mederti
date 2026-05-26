"use client";

import { useContext } from "react";
import type { DrugDetail, Persona } from "@/lib/chat/types";
import { PersonaToggle } from "../PersonaToggle";
import { PaneContext } from "../PaneContext";
import { SEV_TAG_CLASS, isDrugAvailable, pickPrimary } from "../cardUtils";

// Shared header: name + WHO badge + status tag + persona toggle (top-right).
export function CardHeader({
  drug,
  persona,
  onPersonaChange,
  showATCLine = true,
  showBrands = true,
}: {
  drug: DrugDetail;
  persona: Persona;
  onPersonaChange: (p: Persona) => void;
  showATCLine?: boolean;
  showBrands?: boolean;
}) {
  const pane = useContext(PaneContext);
  const primary = pickPrimary(drug.shortages);
  const available = isDrugAvailable(drug, "AU");
  const status = available ? "available" : primary?.severity || "medium";
  const statusClass = available ? "tag-status available" : (SEV_TAG_CLASS[primary?.severity || "medium"] || "tag-status medium");
  const statusLabel = available ? "AVAILABLE" : (primary?.severity || "active").toUpperCase();

  return (
    <div className="card-head">
      <div className="card-title-row">
        <div className="card-name">
          <button
            type="button"
            className="card-name-link"
            onClick={() => pane?.open(drug.drug_id)}
            aria-label={`Open ${drug.name} details`}
          >
            {drug.name}
          </button>
          {drug.who_essential_medicine ? <span className="tag-who">WHO ESSENTIAL</span> : null}
          {drug.critical_medicine_eu ? <span className="tag-who" style={{ background: "var(--crit-bg)", color: "var(--crit)", borderColor: "var(--crit-b)" }}>EU CRITICAL</span> : null}
        </div>
        <div className="card-head-right">
          <PersonaToggle value={persona} onChange={onPersonaChange} disabled={available ? ["supplier"] : []} />
          <span className={statusClass}>{statusLabel}</span>
        </div>
      </div>
      {showATCLine && drug.atc_code ? (
        <div className="card-meta">
          {drug.atc_code}{drug.atc_description ? ` · ${drug.atc_description}` : ""}
          {drug.drug_class && drug.drug_class !== drug.atc_description ? ` · ${drug.drug_class}` : ""}
        </div>
      ) : null}
      {showBrands && drug.brand_names.length > 0 ? (
        <div className="card-brands"><em>brands</em>{drug.brand_names.slice(0, 6).join(", ")}</div>
      ) : null}
      <IdentifiersLine drug={drug} />
    </div>
  );
}

// Compact identifiers row — thin grey line listing every populated
// external_identifier (CAS, UNII, RxCUI, EMA product number, SNOMED, ChEMBL).
// Coverage is partial — only keys with non-null values are shown, so the
// line silently hides when the drug has nothing on file. The full ATC code
// already lives on the line above; we surface only the *other* identifiers
// here to avoid duplication.
function IdentifiersLine({ drug }: { drug: DrugDetail }) {
  const ids = drug.external_identifiers;
  if (!ids) return null;
  const items: Array<[string, string]> = [];
  if (ids.cas_number) items.push(["CAS", ids.cas_number]);
  if (ids.unii) items.push(["UNII", ids.unii]);
  if (ids.rxcui) items.push(["RxCUI", ids.rxcui]);
  if (ids.ema_product_number) items.push(["EMA", ids.ema_product_number]);
  if (ids.snomed_ct_code) items.push(["SNOMED", ids.snomed_ct_code]);
  if (ids.chembl_id) items.push(["ChEMBL", ids.chembl_id]);
  if (items.length === 0) return null;
  return (
    <div
      style={{
        fontSize: 11,
        color: "var(--app-text-4, #94a3b8)",
        marginTop: 4,
        display: "flex",
        flexWrap: "wrap",
        gap: 10,
        alignItems: "center",
      }}
    >
      {items.map(([k, v]) => (
        <span key={k} style={{ display: "inline-flex", alignItems: "baseline", gap: 4 }}>
          <span style={{ textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 600 }}>{k}</span>
          <span
            style={{
              fontFamily: "var(--font-dm-mono), ui-monospace, monospace",
              color: "var(--app-text-2, #475569)",
            }}
          >
            {v}
          </span>
        </span>
      ))}
    </div>
  );
}

// Status panel — amber when in shortage, green when available.
export function StatusPanel({
  drug,
  country = "AU",
  variant = "default",
}: {
  drug: DrugDetail;
  country?: string;
  variant?: "default" | "available";
}) {
  const available = variant === "available" || isDrugAvailable(drug, country);
  const primary = pickPrimary(drug.shortages);
  if (available) {
    const supplierCount = (drug as any).supplier_count ?? null;
    return (
      <div className="card-a-status available">
        <div className="card-a-status-headline">
          <span className="card-a-status-dot" />
          Available in {country}
        </div>
        <div className="card-a-status-dates">
          <span className="card-a-status-supply">
            {supplierCount != null ? `${supplierCount} supplier${supplierCount === 1 ? "" : "s"} active · ` : ""}stable supply
          </span>
        </div>
      </div>
    );
  }
  if (!primary) return null;
  return (
    <div className="card-a-status">
      <div className="card-a-status-headline">
        <span className="card-a-status-dot" />
        Not available in {country}
      </div>
      <div className="card-a-status-dates">
        {primary.start_date ? (
          <>
            <span className="card-a-status-pre">Since</span>
            <span className="card-a-status-val">{formatDateShort(primary.start_date)}</span>
          </>
        ) : null}
        {primary.estimated_resolution_date ? (
          <>
            <span className="card-a-status-sep">·</span>
            <span className="card-a-status-pre">Est. return</span>
            <span className="card-a-status-val">{formatDateShort(primary.estimated_resolution_date)}</span>
          </>
        ) : null}
      </div>
    </div>
  );
}

function formatDateShort(d: string): string {
  try {
    return new Date(d).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return d;
  }
}

// Reuse pane button context.
export function useOpenPane() {
  const pane = useContext(PaneContext);
  return (id: string) => pane?.open(id);
}
