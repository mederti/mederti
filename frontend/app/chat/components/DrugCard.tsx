"use client";

import { useEffect, useState } from "react";
import type { DrugDetail, DrugDetailBundle, Persona } from "@/lib/chat/types";
import { PharmacistCard } from "./cards/PharmacistCard";
import { ProcurementCard } from "./cards/ProcurementCard";
import { SupplierCard } from "./cards/SupplierCard";
import { isDrugAvailable } from "./cardUtils";
import { readStoredPersona, writeStoredPersona } from "./PersonaToggle";

// Simple in-memory cache so repeated cards for the same drug don't re-fetch.
const bundleCache = new Map<string, DrugDetailBundle>();

export function DrugCard({
  drug,
  personaAttr,
}: {
  drug: DrugDetail;
  personaAttr?: Persona;
}) {
  // Choose persona: explicit tag attribute wins, otherwise localStorage, otherwise pharmacist.
  const [persona, setPersona] = useState<Persona>(() => personaAttr ?? readStoredPersona());
  // If the LLM passed a persona, lock to that turn but let the user still toggle.
  const [bundle, setBundle] = useState<DrugDetailBundle | null>(() => bundleCache.get(drug.drug_id) ?? null);
  const [loading, setLoading] = useState(!bundle);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (bundle) return;
    let cancelled = false;
    setLoading(true);
    setErr(null);
    fetch(`/api/drug/${drug.drug_id}?country=AU`)
      .then((r) => r.json())
      .then((data: DrugDetailBundle) => {
        if (cancelled) return;
        if ((data as any).error) {
          setErr((data as any).error);
        } else {
          bundleCache.set(drug.drug_id, data);
          setBundle(data);
        }
      })
      .catch((e) => { if (!cancelled) setErr(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [drug.drug_id, bundle]);

  const onPersonaChange = (p: Persona) => {
    setPersona(p);
    writeStoredPersona(p);
  };

  // If the drug is available, supplier persona doesn't apply — flip to procurement.
  const effective: Persona = (() => {
    const d = bundle?.drug ?? drug;
    if (persona === "supplier" && isDrugAvailable(d, "AU")) return "procurement";
    return persona;
  })();

  if (loading || !bundle) {
    return <CardSkeleton drug={drug} />;
  }
  if (err) {
    return <div className="err">Couldn't load card data: {err}</div>;
  }

  switch (effective) {
    case "procurement":
      return <ProcurementCard bundle={bundle} persona={persona} onPersonaChange={onPersonaChange} />;
    case "supplier":
      return <SupplierCard bundle={bundle} persona={persona} onPersonaChange={onPersonaChange} />;
    case "pharmacist":
    default:
      return <PharmacistCard bundle={bundle} persona={persona} onPersonaChange={onPersonaChange} />;
  }
}

function CardSkeleton({ drug }: { drug: DrugDetail }) {
  return (
    <div className="card card-skeleton">
      <div className="card-head">
        <div className="card-title-row">
          <div className="card-name">{drug.name}</div>
          <div className="skeleton-pill" />
        </div>
        <div className="card-meta">{drug.atc_code ?? ""}</div>
      </div>
      <div className="card-skeleton-bars">
        <div className="skeleton-bar" />
        <div className="skeleton-bar" style={{ width: "80%" }} />
        <div className="skeleton-bar" style={{ width: "60%" }} />
      </div>
    </div>
  );
}
