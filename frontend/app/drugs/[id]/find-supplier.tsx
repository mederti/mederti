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
  const [userId, setUserId] = useState<string | undefined>();
  const [userEmail, setUserEmail] = useState<string | undefined>();
  const [userOrganisation, setUserOrganisation] = useState<string>("");

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
      <button type="button" className="find-supplier-btn" onClick={() => setOpen(true)}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M2 3h10l-1 6H3L2 3z" />
          <circle cx="5" cy="11.5" r=".8" fill="currentColor" stroke="none" />
          <circle cx="9" cy="11.5" r=".8" fill="currentColor" stroke="none" />
        </svg>
        Find a supplier
      </button>

      <SupplierDrawer
        isOpen={open}
        onClose={() => setOpen(false)}
        drugName={drugName}
        drugId={drugId}
        severity={severity}
        partner={MEDERTI_BROKER}
        userCountry={userCountry}
        userId={userId}
        userEmail={userEmail}
        userOrganisation={userOrganisation}
        broker
      />
    </div>
  );
}
