"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { MEDERTI_BROKER } from "@/lib/suppliers";
import { SupplierDrawer } from "./supplier-drawer";

interface Props {
  drugId: string;
  drugName: string;
  userCountry: string;
  severity: string;
}

/**
 * "Find a supplier" CTA for the live (V1) drug page.
 *
 * Unlike the legacy HeaderActions button — which only appeared for the AU/GB
 * wholesale partners — this is universal: clicking it opens a short request
 * form that goes to the Mederti sourcing team, who look into whether the drug
 * can be purchased on the buyer's behalf. Routing happens server-side in
 * /api/supplier-enquiry (the Mederti inbox is always notified).
 */
export function FindSupplier({ drugId, drugName, userCountry, severity }: Props) {
  const supabase = createBrowserClient();

  const [open, setOpen] = useState(false);
  const [prefillMessage, setPrefillMessage] = useState<string | undefined>();
  const [userId, setUserId] = useState<string | undefined>();
  const [userEmail, setUserEmail] = useState<string | undefined>();
  const [userOrganisation, setUserOrganisation] = useState<string>("");

  // Open the drawer pre-filled from a specific parallel-import lane. The
  // ParallelTradeSourcing panel dispatches this event so "Request via Mederti"
  // carries the route context (source country, distributor, pack) — the two are
  // separate client islands, so a CustomEvent keeps them decoupled.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ message?: string }>).detail;
      setPrefillMessage(detail?.message);
      setOpen(true);
    };
    window.addEventListener("mederti:sourcing-request", handler as EventListener);
    return () => window.removeEventListener("mederti:sourcing-request", handler as EventListener);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (cancelled || !session) return;
      setUserId(session.user.id);
      setUserEmail(session.user.email ?? undefined);
      const meta = session.user.user_metadata;
      setUserOrganisation(
        meta?.organisation ?? meta?.company ?? meta?.business_name ?? ""
      );
    })();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="find-supplier-row">
      <span className="find-supplier-hint">Ask Mederti to source this on your behalf</span>
      <button type="button" className="find-supplier-btn" onClick={() => { setPrefillMessage(undefined); setOpen(true); }}>
        {/* mederti logo mark — rounded hexagonal nut, drawn in white. The thick
            round-joined stroke leaves a hexagonal hole that shows the black
            button through, matching the brand mark. */}
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4.5" strokeLinejoin="round" aria-hidden>
          <path d="M12 3.5 L19.36 7.75 L19.36 16.25 L12 20.5 L4.64 16.25 L4.64 7.75 Z" />
        </svg>
        Find a supplier
      </button>

      <SupplierDrawer
        isOpen={open}
        onClose={() => { setOpen(false); setPrefillMessage(undefined); }}
        drugName={drugName}
        drugId={drugId}
        severity={severity}
        partner={MEDERTI_BROKER}
        userCountry={userCountry}
        userId={userId}
        userEmail={userEmail}
        userOrganisation={userOrganisation}
        prefillMessage={prefillMessage}
        broker
      />
    </div>
  );
}
