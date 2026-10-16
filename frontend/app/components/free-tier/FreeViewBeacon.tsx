"use client";

import { useEffect } from "react";

/** Records this drug page as one anonymous free-tier view (see lib/free-views.ts). */
export function FreeViewBeacon({ drugId }: { drugId: string }) {
  useEffect(() => {
    fetch("/api/free-views", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ drug_id: drugId }),
      keepalive: true,
    }).catch(() => {});
  }, [drugId]);
  return null;
}
