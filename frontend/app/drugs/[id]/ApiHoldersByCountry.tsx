"use client";

import { useEffect, useState } from "react";

// Known FDA DMF API holders by country for this molecule, from
// /api/api-country-dependence (salt forms and US names grouped together).
// Loaded after the page: the route's index is cached, but a cold build takes
// seconds and must not hold up the drug page.

type View = {
  dmf_holders: number;
  holders_by_country?: { country: string; holders: number }[];
  holders_without_country?: number;
  classification?: "single_country" | "single_known_country_some_unknown" | "multi_country" | "no_country_data";
  biologic_note?: string;
  sources?: { name: string; last_refreshed?: string | null }[];
};

export default function ApiHoldersByCountry({ drugId }: { drugId: string }) {
  const [v, setV] = useState<View | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/api-country-dependence?drug_id=${encodeURIComponent(drugId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (live && j && j.dmf_holders > 0) setV(j); })
      .catch(() => {});
    return () => { live = false; };
  }, [drugId]);

  if (!v) return null;
  const countries = v.holders_by_country ?? [];
  const unknown = v.holders_without_country ?? 0;
  const asOf = v.sources?.[0]?.last_refreshed;
  const only = countries.length === 1 ? countries[0].country : null;

  return (
    <div className="conc-d" style={{ marginTop: 10 }}>
      <div>
        <strong>Known FDA DMF holders by country ({v.dmf_holders}):</strong>{" "}
        {[...countries.map((c) => `${c.country} ${c.holders}`), unknown ? `country not on file ${unknown}` : null].filter(Boolean).join(" · ")}
      </div>
      {!v.biologic_note && only && v.classification === "single_country" && (
        <div>All {v.dmf_holders} known holder{v.dmf_holders !== 1 ? "s are" : " is"} in {only}.</div>
      )}
      {!v.biologic_note && only && v.classification === "single_known_country_some_unknown" && (
        <div>Every holder with a known country is in {only}; {unknown} {unknown === 1 ? "has" : "have"} no country on file.</div>
      )}
      {v.biologic_note && <div>{v.biologic_note}</div>}
      <div className="attr-muted">
        Counts DMF filings, not market share or supply volumes; makers without a US DMF are not included. Country is the
        holder&apos;s FDA-registered establishment (FDA DECRS), matched by name. FDA DMF list{asOf ? `, last ingested ${asOf}` : ""}.
      </div>
    </div>
  );
}
