"use client";

import { useContext } from "react";
import type { DrugDetail, DrugDetailBundle, Persona } from "@/lib/chat/types";
import { LeadContext } from "../LeadContext";
import { PaneContext } from "../PaneContext";
import { CardHeader } from "./CardChrome";
import { perCountrySeverity, pickPrimary } from "../cardUtils";
import { ManufacturersStrip, ShortageHistoryLine } from "./ManufacturerAndHistory";
import { RecallCallout } from "./RecallCallout";

const HISTORICAL_AU_BASELINE = 8; // Typical AU supplier count for a WHO-essential generic.

export function SupplierCard({
  bundle,
  persona,
  onPersonaChange,
}: {
  bundle: DrugDetailBundle;
  persona: Persona;
  onPersonaChange: (p: Persona) => void;
}) {
  const drug = bundle.drug;
  const lead = useContext(LeadContext);
  const pane = useContext(PaneContext);

  const countries = perCountrySeverity(drug.shortages);
  const signals = drug.shortages.filter((s) => s.status === "active").length;
  const primary = pickPrimary(drug.shortages);

  // Running time = months since the oldest active start_date.
  const oldestActive = drug.shortages
    .filter((s) => s.status === "active" && s.start_date)
    .map((s) => new Date(s.start_date as string).getTime())
    .sort((a, b) => a - b)[0];
  const monthsRunning = oldestActive
    ? Math.max(1, Math.round((Date.now() - oldestActive) / (1000 * 60 * 60 * 24 * 30)))
    : null;
  const sinceLabel = oldestActive
    ? new Date(oldestActive).toLocaleDateString("en-AU", { month: "short", year: "2-digit" })
    : null;

  // Supplier coverage gauge — based on current supplier_inventory rows for AU.
  const auSuppliers = (bundle.suppliers ?? []).filter((s) => s.countries.includes("AU"));
  const currentCount = auSuppliers.length;
  const gapPct = Math.max(5, Math.round((currentCount / HISTORICAL_AU_BASELINE) * 100));
  const showCoverage = signals > 0; // Only show the gap framing when there IS a shortage signal.

  return (
    <div className="card">
      <CardHeader drug={drug} persona={persona} onPersonaChange={onPersonaChange} />

      <RecallCallout bundle={bundle} />

      <div className="card-c-hero">
        <div className="card-c-hero-label">⚡ Active demand signal</div>
        <div className="card-c-hero-row">
          <div>
            <div className="card-c-stat-val">{countries.length}</div>
            <div className="card-c-stat-label">Countries</div>
            <div className="card-c-stat-sub">active shortage</div>
          </div>
          <div>
            <div className="card-c-stat-val">{signals}</div>
            <div className="card-c-stat-label">Signals</div>
            <div className="card-c-stat-sub">regulator reports</div>
          </div>
          <div>
            <div className="card-c-stat-val">{monthsRunning ? `${monthsRunning}mo` : "—"}</div>
            <div className="card-c-stat-label">Running</div>
            <div className="card-c-stat-sub">{sinceLabel ? `since ${sinceLabel}` : "—"}</div>
          </div>
        </div>
      </div>

      {/* Market pricing block is hidden — per-drug pricing isn't in the DB yet. */}

      {showCoverage ? (
        <div className="card-c-supplier-bar">
          <div className="card-c-supplier-head">
            <div className="card-c-supplier-label">Active supplier coverage · AU</div>
            <div className="card-c-supplier-gauge">{currentCount} of ~{HISTORICAL_AU_BASELINE} typical · {gapPct}%</div>
          </div>
          <div className="card-c-supplier-bar-bg">
            <div className="card-c-supplier-bar-fill" style={{ width: `${gapPct}%` }} />
          </div>
          <div className="card-c-supplier-note">
            {currentCount === 0
              ? <><strong>Significant supply gap.</strong> No suppliers currently reporting AU stock on Mederti. Parallel-import pathways open for verified wholesalers.</>
              : currentCount < HISTORICAL_AU_BASELINE / 2
              ? <><strong>Supply gap.</strong> {HISTORICAL_AU_BASELINE - currentCount} of ~{HISTORICAL_AU_BASELINE} historical AU suppliers not currently reporting stock.</>
              : <>Coverage is partial — opportunity to deepen presence.</>}
          </div>
        </div>
      ) : null}

      {primary?.reason ? (
        <div className="card-b-reason">
          <span className="card-b-reason-label">Driver</span>
          {primary.reason.length > 240 ? primary.reason.slice(0, 240) + "…" : primary.reason}
        </div>
      ) : null}

      <div className="card-mfg-header"><span className="card-b-reason-label">Current market participants</span></div>
      <ManufacturersStrip bundle={bundle} country="AU" />
      <ShortageHistoryLine history={bundle.history} />

      <div className="card-actions">
        <button
          type="button"
          className="btn-primary teal"
          onClick={() =>
            lead?.open({
              lead_type: "supplier_interest",
              drug_id: drug.drug_id,
              drug_name: drug.name,
              country_code: "AU",
            })
          }
        >
          ⚡ Express supply interest
        </button>
        <span className="link-src" onClick={() => pane?.open(drug.drug_id)}>↗ Full market intel</span>
        <div className="actions-spacer" />
        <span className="link-src" onClick={() => pane?.open(drug.drug_id)}>↗ Shortage timeline</span>
      </div>
    </div>
  );
}
