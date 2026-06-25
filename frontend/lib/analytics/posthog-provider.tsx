"use client";

import posthog from "posthog-js";
import { PostHogProvider as PHProvider } from "posthog-js/react";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { createBrowserClient } from "@/lib/supabase/client";

/**
 * PostHog product analytics — identified per-user events, funnels, retention.
 *
 * Inert until configured: if NEXT_PUBLIC_POSTHOG_KEY is unset (local dev, or
 * before the team opts in), this renders children untouched and loads nothing.
 *
 * Privacy posture (health-sector, EU userbase):
 *   • api_host defaults to the EU cloud (data residency in the EU).
 *   • person_profiles: "identified_only" — anonymous visitors don't get a
 *     person profile, so we only build profiles for signed-in users.
 *   • session recording is OFF — no screen replays of clinical workflows.
 *   • pageviews capture the PATH ONLY — query strings (e.g. ?q=<search term>)
 *     are deliberately dropped so user search text never lands in PostHog.
 *   • PostHog autocapture does not record the *values* typed into inputs.
 *
 * NOTE: a cookie-consent decision is still outstanding for EU users. This sets
 * PostHog's default cookie. If you need explicit opt-in, gate init() on consent.
 */

const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://eu.i.posthog.com";

// Initialise once, at client module load — before any component effects run, so
// the first pageview isn't missed. Guarded for SSR and for the no-key case.
if (typeof window !== "undefined" && KEY) {
  posthog.init(KEY, {
    api_host: HOST,
    person_profiles: "identified_only",
    capture_pageview: false, // we send manual SPA pageviews (see PageviewTracker)
    capture_pageleave: true,
    autocapture: true,
    disable_session_recording: true,
  });
}

/** Fire a $pageview on every App Router navigation (path only). */
function PageviewTracker() {
  const pathname = usePathname();
  useEffect(() => {
    if (!KEY || !pathname) return;
    posthog.capture("$pageview", {
      $current_url: window.location.origin + pathname,
    });
  }, [pathname]);
  return null;
}

/** Tie the PostHog person to the Supabase user: identify on login, reset on logout. */
function IdentityTracker() {
  useEffect(() => {
    if (!KEY) return;
    const supabase = createBrowserClient();
    const sync = (session: Session | null) => {
      const user = session?.user;
      if (user) {
        const role = (user.user_metadata as { role?: string } | undefined)?.role;
        // Identify by user_id only; role is a non-sensitive cohort trait.
        // No email / PII is sent as a person property.
        posthog.identify(user.id, role ? { role } : undefined);
      } else {
        posthog.reset();
      }
    };
    supabase.auth.getSession().then(({ data: { session } }) => sync(session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => sync(session));
    return () => sub.subscription.unsubscribe();
  }, []);
  return null;
}

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  if (!KEY) return <>{children}</>;
  return (
    <PHProvider client={posthog}>
      <PageviewTracker />
      <IdentityTracker />
      {children}
    </PHProvider>
  );
}
