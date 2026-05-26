"use client";

import { useContext } from "react";
import type { DrugDetail, DrugDetailBundle, Persona } from "@/lib/chat/types";
import { LeadContext } from "../LeadContext";
import { PaneContext } from "../PaneContext";
import { CardHeader, StatusPanel } from "./CardChrome";
import { formatPrice, isDrugAvailable, pickPrimary, topSupplier } from "../cardUtils";
import { ShortageHistoryLine } from "./ManufacturerAndHistory";
import { RecallCallout } from "./RecallCallout";
import { ChatContext } from "../ChatContext";

export function PharmacistCard({
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
      <CardHeader drug={drug} persona={persona} onPersonaChange={onPersonaChange} showATCLine={false} showBrands={false} />
      {available
        ? <StateB drug={drug} bundle={bundle} />
        : <StateA drug={drug} bundle={bundle} />}
    </div>
  );
}

// State A: drug is in shortage. Surface a substitute the user can dispense now, plus pre-order.
function StateA({ drug, bundle }: { drug: DrugDetail; bundle: DrugDetailBundle }) {
  const lead = useContext(LeadContext);
  const pane = useContext(PaneContext);
  const chat = useContext(ChatContext);
  const subs = bundle.substitutes ?? [];
  const headSub = subs.find((s) => s.active_shortage_count === 0) ?? subs[0] ?? null;
  const subSuppliers = headSub?.suppliers ?? [];
  const topSub = topSupplier(subSuppliers);
  const subSupplierCount = subSuppliers.length;

  return (
    <>
      <RecallCallout bundle={bundle} />
      <StatusPanel drug={drug} country="AU" />

      <div className="card-a-preorder">
        <div className="card-a-preorder-text">
          <strong>Pre-order {drug.name}</strong> — we'll match a verified supplier when stock returns.
        </div>
        <button
          type="button"
          className="card-a-preorder-btn"
          onClick={() =>
            lead?.open({
              lead_type: "pre_order",
              drug_id: drug.drug_id,
              drug_name: drug.name,
              country_code: "AU",
            })
          }
        >
          ⚡ Pre-order
        </button>
      </div>

      {headSub ? (
        <div className="card-a-sub">
          <div className="card-a-sub-head">
            <div className="card-a-sub-label">✓ Available alternative · dispense now</div>
            <div className="card-a-sub-match">
              {headSub.similarity_score != null ? `${Math.round(headSub.similarity_score * 100)}% clinical match` : "match —"}
            </div>
          </div>
          <div
            className="card-a-sub-name card-a-sub-name-button"
            onClick={() => chat?.send(`Tell me about ${headSub.name}`)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); chat?.send(`Tell me about ${headSub.name}`); } }}
            aria-label={`Open ${headSub.name} as a new card in chat`}
          >
            {headSub.name}<span className="card-a-sub-name-arrow">→</span>
          </div>
          <div className="card-a-sub-form">
            {headSub.atc_code ?? ""}
            {headSub.drug_class ? ` · ${headSub.drug_class}` : ""}
            {headSub.clinical_evidence_level ? ` · evidence ${headSub.clinical_evidence_level}` : ""}
          </div>
          <div className="card-a-sub-facts">
            <div className="card-a-sub-fact">
              <div className="card-a-sub-fact-label">AU stock</div>
              <div className="card-a-sub-fact-val">{headSub.active_shortage_count === 0 ? "Available" : "Limited"}</div>
            </div>
            {topSub?.unit_price != null ? (
              <div className="card-a-sub-fact">
                <div className="card-a-sub-fact-label">AU trade</div>
                <div className="card-a-sub-fact-val">from {formatPrice(topSub.unit_price, topSub.currency)}</div>
              </div>
            ) : null}
            {headSub.requires_monitoring ? (
              <div className="card-a-sub-fact">
                <div className="card-a-sub-fact-label">Notes</div>
                <div className="card-a-sub-fact-val" style={{ fontSize: 11 }}>monitoring required</div>
              </div>
            ) : null}
          </div>

          {subSupplierCount > 0 ? (
            <div className="card-a-supplier">
              <div className="card-a-supplier-label">
                <span>Suppliers with stock · AU</span>
                <span className="card-a-supplier-label-count">{subSupplierCount} active</span>
              </div>
              {topSub ? (
                <div className="card-a-supplier-row">
                  <div className="card-a-supplier-name">
                    {topSub.supplier_name ?? "Verified supplier"}
                    {topSub.verified ? <span className="card-a-supplier-pill">verified</span> : null}
                  </div>
                  <div className="card-a-supplier-meta">
                    {topSub.unit_price != null ? formatPrice(topSub.unit_price, topSub.currency) : ""}
                    {topSub.pack_size ? ` · ${topSub.pack_size}` : ""}
                  </div>
                  <button
                    type="button"
                    className="card-a-supplier-action"
                    onClick={() =>
                      lead?.open({
                        lead_type: "order",
                        drug_id: drug.drug_id,
                        drug_name: drug.name,
                        alternative_drug_id: headSub.drug_id,
                        alternative_drug_name: headSub.name,
                        supplier_name: topSub.supplier_name ?? undefined,
                        country_code: "AU",
                      })
                    }
                  >
                    Order →
                  </button>
                </div>
              ) : null}
              {subSupplierCount > 1 ? (
                <span className="card-a-supplier-more">+ {subSupplierCount - 1} more supplier{subSupplierCount > 2 ? "s" : ""}</span>
              ) : null}
            </div>
          ) : (
            <div className="card-a-supplier">
              <div className="card-a-supplier-label">
                <span>Suppliers with stock · AU</span>
                <span className="card-a-supplier-label-count">no listings yet</span>
              </div>
              <button
                type="button"
                className="card-a-supplier-action card-a-supplier-action-block"
                onClick={() =>
                  lead?.open({
                    lead_type: "order",
                    drug_id: drug.drug_id,
                    drug_name: drug.name,
                    alternative_drug_id: headSub.drug_id,
                    alternative_drug_name: headSub.name,
                    country_code: "AU",
                    notes: `No supplier inventory on file for ${headSub.name} in AU. Requesting quote.`,
                  })
                }
              >
                Request a quote →
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="card-a-context">
          Mederti doesn't have an ATC-matched alternative on file for {drug.name} yet. The pre-order signal will route a supplier match when one becomes available.
        </div>
      )}

      <ManufacturersOneLiner bundle={bundle} country="AU" />
      <ShortageHistoryLine history={bundle.history} />

      <div className="card-a-context">
        {drug.therapeutic_category ? <>Therapeutic class: {drug.therapeutic_category}. </> : null}
        Confirm clinical suitability before dispensing the substitute — Mederti's match is class-based, not dose-equivalent.
      </div>

      <div className="card-actions">
        {subSupplierCount > 0 ? <span className="link-src" onClick={() => pane?.open(drug.drug_id)}>↗ Compare all suppliers</span> : null}
        <div className="actions-spacer" />
        <span className="link-src" onClick={() => pane?.open(drug.drug_id)}>↗ Other substitutes</span>
        <span className="link-src" onClick={() => pane?.open(drug.drug_id)}>↗ View {drug.name} record</span>
      </div>
    </>
  );
}

// Pharmacist-flavoured manufacturer mention: short, conversational.
function ManufacturersOneLiner({ bundle, country = "AU" }: { bundle: DrugDetailBundle; country?: string }) {
  const all = bundle.manufacturers ?? [];
  const inCountry = all.filter((m) => m.country === country || (m.countries_supplied || []).includes(country));
  const subset = inCountry.length > 0 ? inCountry : all;
  if (subset.length === 0) return null;
  const cleaned = subset
    .slice(0, 4)
    .map((m) => m.name.replace(/\s+(PTY LTD|PTY LIMITED|LIMITED|LTD|LLC|INC\.?|GMBH|SRL|N\.?V\.?|S\.?A\.?)\s*$/i, "").replace(/[,.]\s*$/, "").trim());
  const more = subset.length - cleaned.length;
  return (
    <div className="card-a-context" style={{ paddingTop: 0, fontSize: 11.5 }}>
      <strong style={{ fontWeight: 500 }}>Made for {country}</strong> by {cleaned.join(", ")}
      {more > 0 ? ` + ${more} other${more === 1 ? "" : "s"}` : ""}.
    </div>
  );
}

// State B: drug is available. Just show suppliers, sorted by price.
function StateB({ drug, bundle }: { drug: DrugDetail; bundle: DrugDetailBundle }) {
  const lead = useContext(LeadContext);
  const pane = useContext(PaneContext);
  const auSuppliers = (bundle.suppliers ?? []).filter((s) => s.countries.includes("AU"));
  const top = auSuppliers[0] ?? null;

  return (
    <>
      <RecallCallout bundle={bundle} />
      <StatusPanel drug={drug} country="AU" variant="available" />

      {auSuppliers.length > 0 ? (
        <div className="card-a-state-b-suppliers">
          <div className="card-a-supplier-label">
            <span>Suppliers with stock · AU</span>
            <span className="card-a-supplier-label-count">{auSuppliers.length} active · sorted by price</span>
          </div>
          {auSuppliers.slice(0, 2).map((s, i) => (
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
          {auSuppliers.length > 2 ? (
            <span className="card-a-supplier-more">+ {auSuppliers.length - 2} more · sorted by price ↓</span>
          ) : null}
        </div>
      ) : (
        <div className="card-a-state-b-suppliers">
          <div className="card-a-supplier-label">
            <span>Suppliers · AU</span>
            <span className="card-a-supplier-label-count">no listings on file</span>
          </div>
          <button
            type="button"
            className="card-a-supplier-action card-a-supplier-action-block"
            onClick={() =>
              lead?.open({
                lead_type: "order",
                drug_id: drug.drug_id,
                drug_name: drug.name,
                country_code: "AU",
                notes: `No supplier inventory on file for ${drug.name} in AU. Requesting quote.`,
              })
            }
          >
            Request a quote from a verified supplier →
          </button>
        </div>
      )}

      <div className="card-actions">
        {auSuppliers.length > 0 ? <span className="link-src" onClick={() => pane?.open(drug.drug_id)}>↗ Compare all {auSuppliers.length} suppliers</span> : null}
        <div className="actions-spacer" />
        <span className="link-src" onClick={() => pane?.open(drug.drug_id)}>↗ View {drug.name} record</span>
      </div>
    </>
  );
}
