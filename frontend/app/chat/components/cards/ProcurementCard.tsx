"use client";

import { useContext } from "react";
import type { DrugDetail, DrugDetailBundle, Persona } from "@/lib/chat/types";
import { LeadContext } from "../LeadContext";
import { PaneContext } from "../PaneContext";
import { CardHeader, StatusPanel } from "./CardChrome";
import { SEV_DOT_CLASS, isDrugAvailable, perCountrySeverity, pickPrimary, uniqueRegulatorSources, formatPrice } from "../cardUtils";
import { ManufacturersStrip, ShortageHistoryLine } from "./ManufacturerAndHistory";
import { RecallCallout } from "./RecallCallout";
import { TradePriceStrip } from "./PharmacistCard";

export function ProcurementCard({
  bundle,
  persona,
  onPersonaChange,
}: {
  bundle: DrugDetailBundle;
  persona: Persona;
  onPersonaChange: (p: Persona) => void;
}) {
  const drug = bundle.drug;
  const available = isDrugAvailable(drug, "AU");
  return (
    <div className="card">
      <CardHeader drug={drug} persona={persona} onPersonaChange={onPersonaChange} />
      <TradePriceStrip tradePrice={bundle.tradePrice} />
      {available
        ? <StateB drug={drug} bundle={bundle} />
        : <StateA drug={drug} bundle={bundle} />}
    </div>
  );
}

function StateA({ drug, bundle }: { drug: DrugDetail; bundle: DrugDetailBundle }) {
  const lead = useContext(LeadContext);
  const pane = useContext(PaneContext);
  const primary = pickPrimary(drug.shortages);
  const countries = perCountrySeverity(drug.shortages);
  const signals = drug.shortages.filter((s) => s.status === "active").length;
  const sources = uniqueRegulatorSources(drug.shortages, 2);
  const subs = bundle.substitutes ?? [];

  return (
    <>
      <RecallCallout bundle={bundle} />
      <StatusPanel drug={drug} country="AU" />

      <div className="card-a-preorder">
        <div className="card-a-preorder-text">
          <strong>Forward order {drug.name}</strong> — receive committed delivery quotes from verified wholesalers when stock returns.
        </div>
        <button
          type="button"
          className="card-a-preorder-btn"
          onClick={() =>
            lead?.open({
              lead_type: "forward_order",
              drug_id: drug.drug_id,
              drug_name: drug.name,
              country_code: "AU",
            })
          }
        >
          ⚡ Forward order
        </button>
      </div>

      {countries.length > 0 ? (
        <>
          <hr className="divider-dashed" />
          <div className="card-b-row">
            <div className="section-label">
              Active in {countries.length} {countries.length === 1 ? "country" : "countries"} · {signals} signal{signals === 1 ? "" : "s"}
            </div>
            <div className="country-row">
              {countries.slice(0, 12).map((c) => (
                <span key={c.code} className="country-pill" title={`${c.name} · ${c.severity}`}>
                  {c.code} <span className={SEV_DOT_CLASS[c.severity] || "country-pill-dot med"} />
                </span>
              ))}
              {countries.length > 12 ? <span className="card-a-supplier-more">+{countries.length - 12}</span> : null}
            </div>
          </div>
        </>
      ) : null}

      <hr className="divider-dashed" />

      <div className="card-b-row">
        <div className="card-b-grid">
          {drug.strengths.length > 0 ? (
            <div className="card-b-fact">
              <div className="card-b-fact-label">Strengths</div>
              <div className="card-b-fact-val">{drug.strengths.slice(0, 4).join(" / ")}</div>
            </div>
          ) : null}
          {drug.dosage_forms.length > 0 ? (
            <div className="card-b-fact">
              <div className="card-b-fact-label">Forms</div>
              <div className="card-b-fact-val">{drug.dosage_forms.slice(0, 3).join(", ")}</div>
            </div>
          ) : null}
          {primary?.country ? (
            <div className="card-b-fact">
              <div className="card-b-fact-label">Latest signal</div>
              <div className="card-b-fact-val">{primary.country}</div>
              <div className="card-b-fact-sub">{primary.start_date ? new Date(primary.start_date).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" }) : ""}</div>
            </div>
          ) : null}
          {primary?.estimated_resolution_date ? (
            <div className="card-b-fact">
              <div className="card-b-fact-label">Est. resolution</div>
              <div className="card-b-fact-val mono">{new Date(primary.estimated_resolution_date).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}</div>
            </div>
          ) : null}
        </div>
      </div>

      {primary?.reason ? (
        <div className="card-b-reason">
          <span className="card-b-reason-label">Reason</span>
          {primary.reason.length > 280 ? primary.reason.slice(0, 280) + "…" : primary.reason}
        </div>
      ) : null}

      <ManufacturersStrip bundle={bundle} country="AU" />
      <ShortageHistoryLine history={bundle.history} />

      {subs.length > 0 ? (
        <div className="card-b-alts">
          <div className="card-b-alts-label">Formulary alternatives</div>
          {subs.slice(0, 4).map((s) => {
            const supplierCount = (s.suppliers?.length ?? 0);
            const names = (s.suppliers ?? []).map((x) => x.supplier_name).filter(Boolean).slice(0, 3).join(", ");
            const minPrice = (s.suppliers ?? []).map((x) => x.unit_price).filter((p): p is number => p != null).sort((a, b) => a - b)[0];
            const minCur = (s.suppliers ?? []).find((x) => x.unit_price === minPrice)?.currency ?? null;
            const inShortage = s.active_shortage_count > 0;
            return (
              <div key={s.drug_id} className="card-b-alt-row" onClick={() => pane?.open(s.drug_id)} role="button" style={{ cursor: "pointer" }}>
                <div className="card-b-alt-info">
                  <div>
                    <span className="card-b-alt-name">{s.name}</span>
                    {s.drug_class ? <span className="card-b-alt-meta"> · {s.drug_class}</span> : null}
                    {s.clinical_evidence_level ? <span className="card-b-alt-meta"> · evidence {s.clinical_evidence_level}</span> : null}
                  </div>
                  {supplierCount > 0 ? (
                    <div className="card-b-alt-suppliers">
                      <strong>{supplierCount} supplier{supplierCount === 1 ? "" : "s"}</strong>
                      {names ? ` · ${names}` : ""}
                      {minPrice != null ? ` · from ${formatPrice(minPrice, minCur)}` : ""}
                    </div>
                  ) : (
                    <div className="card-b-alt-suppliers">No supplier listings on Mederti yet</div>
                  )}
                </div>
                <span className={`card-b-alt-status ${inShortage ? "amber" : "green"}`}>
                  {inShortage ? `Limited · ${s.active_shortage_count} short` : "Available · AU"}
                </span>
              </div>
            );
          })}
        </div>
      ) : null}

      <div className="card-actions">
        <button type="button" className="btn-primary" onClick={() => pane?.open(drug.drug_id)}>View details →</button>
        {sources.map((s, i) => (
          <a key={i} className="link-src" href={s.url} target="_blank" rel="noreferrer noopener">{s.country} source ↗</a>
        ))}
        <div className="actions-spacer" />
        <span
          className="link-src"
          onClick={() =>
            lead?.open({
              lead_type: "forward_order",
              drug_id: drug.drug_id,
              drug_name: drug.name,
              country_code: "AU",
              notes: "Set procurement alert when status changes",
            })
          }
        >
          Set procurement alert ↗
        </span>
      </div>
    </>
  );
}

function StateB({ drug, bundle }: { drug: DrugDetail; bundle: DrugDetailBundle }) {
  const lead = useContext(LeadContext);
  const pane = useContext(PaneContext);
  const auSuppliers = (bundle.suppliers ?? []).filter((s) => s.countries.includes("AU"));

  return (
    <>
      <RecallCallout bundle={bundle} />
      <StatusPanel drug={drug} country="AU" variant="available" />

      <hr className="divider-dashed" />

      <div className="card-b-row">
        <div className="card-b-grid">
          {drug.strengths.length > 0 ? (
            <div className="card-b-fact">
              <div className="card-b-fact-label">Strengths</div>
              <div className="card-b-fact-val">{drug.strengths.slice(0, 4).join(" / ")}</div>
            </div>
          ) : null}
          {drug.dosage_forms.length > 0 ? (
            <div className="card-b-fact">
              <div className="card-b-fact-label">Forms</div>
              <div className="card-b-fact-val">{drug.dosage_forms.slice(0, 3).join(", ")}</div>
            </div>
          ) : null}
          {drug.routes_of_administration && drug.routes_of_administration.length > 0 ? (
            <div className="card-b-fact">
              <div className="card-b-fact-label">Routes</div>
              <div className="card-b-fact-val">{drug.routes_of_administration.slice(0, 3).join(", ")}</div>
            </div>
          ) : null}
          {drug.therapeutic_category ? (
            <div className="card-b-fact">
              <div className="card-b-fact-label">Category</div>
              <div className="card-b-fact-val">{drug.therapeutic_category}</div>
            </div>
          ) : null}
        </div>
      </div>

      {auSuppliers.length > 0 ? (
        <div className="card-a-state-b-suppliers">
          <div className="card-a-supplier-label">
            <span>Suppliers with stock · AU</span>
            <span className="card-a-supplier-label-count">{auSuppliers.length} active · sorted by price</span>
          </div>
          {auSuppliers.slice(0, 3).map((s, i) => (
            <div key={i} className="card-a-supplier-row">
              <div className="card-a-supplier-name">
                {s.supplier_name ?? "Verified supplier"}
                {s.verified ? <span className="card-a-supplier-pill">verified</span> : null}
              </div>
              <div className="card-a-supplier-meta">
                {s.unit_price != null ? formatPrice(s.unit_price, s.currency) : ""}
                {s.pack_size ? ` · ${s.pack_size}` : ""}
              </div>
              <button
                type="button"
                className="card-a-supplier-action"
                onClick={() =>
                  lead?.open({
                    lead_type: "order",
                    drug_id: drug.drug_id,
                    drug_name: drug.name,
                    supplier_name: s.supplier_name ?? undefined,
                    country_code: "AU",
                  })
                }
              >
                Order →
              </button>
            </div>
          ))}
          {auSuppliers.length > 3 ? (
            <span className="card-a-supplier-more">+ {auSuppliers.length - 3} more</span>
          ) : null}
        </div>
      ) : (
        <div className="card-a-context" style={{ paddingTop: 8 }}>
          No supplier listings on Mederti for {drug.name} in Australia yet.
        </div>
      )}

      <ManufacturersStrip bundle={bundle} country="AU" />
      <ShortageHistoryLine history={bundle.history} />

      <div className="card-actions">
        <button type="button" className="btn-primary" onClick={() => pane?.open(drug.drug_id)}>View details →</button>
        <div className="actions-spacer" />
        <span className="link-src" onClick={() => pane?.open(drug.drug_id)}>↗ Full record</span>
      </div>
    </>
  );
}
