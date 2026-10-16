"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { FREE_VIEW_COUNT_COOKIE } from "@/lib/free-views";

/**
 * Client-side view of the anonymous free tier: `anon` is null until the
 * session check resolves (render nothing gated until then), `used` is the
 * display mirror the proxy writes. Display-only — enforcement is in proxy.ts.
 */
export function useFreeTier(): { anon: boolean | null; used: number } {
  const [anon, setAnon] = useState<boolean | null>(null);
  const [used, setUsed] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const resolve = (isAnon: boolean) => {
      if (cancelled) return;
      const m = document.cookie.match(new RegExp(`(?:^|; )${FREE_VIEW_COUNT_COOKIE}=(\\d+)`));
      setUsed(m ? Number(m[1]) : 0);
      setAnon(isAnon);
    };
    createBrowserClient()
      .auth.getSession()
      .then(({ data: { session } }) => resolve(!session))
      .catch(() => resolve(true));
    return () => { cancelled = true; };
  }, []);
  return { anon, used };
}
