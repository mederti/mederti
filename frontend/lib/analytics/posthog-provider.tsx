"use client";

import posthog from "posthog-js";
import { PostHogProvider as PHProvider } from "posthog-js/react";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { createBrowserClient } from "@/lib/supabase/client";
import { CONSENT_CHANGE_EVENT, readConsent, type ConsentValue } from "@/lib/consent";

/**
 * PostHog product analytics — identified per-user events, funnels, retention.
 *
 * Inert until configured: if NEXT_PUBLIC_POSTHOG_KEY is unset (local dev, or
 * before the team opts in), this renders children untouched and loads nothing.
 *
 * Privacy posture (health-sector, EU userbase):
 *   • CONSENT-GATED: nothing initialises until the user accepts analytics
 *     cookies in the CookieConsent banner (lib/consent.ts). Withdrawing
 *     consent stops capture and deletes PostHog's cookies/localStorage.
 *   • api_host defaults to the EU cloud (data residency in the EU).
 *   • person_profiles: "identified_only" — anonymous visitors don't get a
 *     person profile, so we only build profiles for signed-in users.
 *   • session recording is OFF — no screen replays of clinical workflows.
 *   • pageviews capture the PATH ONLY — query strings (e.g. ?q=<search term>)
 *     are deliberately dropped so user search text never lands in PostHog.
 *   • PostHog autocapture does not record the *values* typed into inputs.
 */

const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://eu.i.posthog.com";

function capturePathOnlyPageview() {
  posthog.capture("$pageview", {
    $current_url: window.location.origin + window.location.pathname,
  });
}

/** Start (or resume) capture. Only ever called after explicit consent. */
function startPostHog() {
  if (!KEY) return;
  if (posthog.__loaded) {
    // Re-granted after a withdrawal in this pageload — resume capture.
    posthog.opt_in_capturing();
    return;
  }
  posthog.init(KEY, {
    api_host: HOST,
    person_profiles: "identified_only",
    capture_pageview: false, // we send manual SPA pageviews (see PageviewTracker)
    capture_pageleave: true,
    autocapture: true,
    disable_session_recording: true,
  });
  // The consent grant may arrive after PageviewTracker's initial effect has
  // already run and skipped, so record the page the user is on right now.
  capturePathOnlyPageview();
}

/** Stop capture and remove everything PostHog stored on this device. */
function stopPostHog() {
  if (!posthog.__loaded) return;
  posthog.opt_out_capturing();
  // opt_out persists its own flag; clear the tracking state itself too, per
  // the withdrawal. PostHog's default persistence is localStorage+cookie,
  // both keyed with a "ph_" prefix.
  try {
    for (const k of Object.keys(window.localStorage)) {
      if (k.startsWith("ph_")) window.localStorage.removeItem(k);
    }
    const host = window.location.hostname;
    for (const raw of document.cookie.split("; ")) {
      const name = raw.split("=")[0];
      if (!name.startsWith("ph_")) continue;
      // Expire under both scopes PostHog may have used (host-only and
      // cross-subdomain) — an unmatched domain attribute is a harmless no-op.
      document.cookie = `${name}=;path=/;max-age=0`;
      document.cookie = `${name}=;path=/;max-age=0;domain=.${host}`;
    }
  } catch {
    /* storage unavailable (private mode etc.) — nothing to clear */
  }
}

/** Fire a $pageview on every App Router navigation (path only). */
function PageviewTracker() {
  const pathname = usePathname();
  useEffect(() => {
    if (!posthog.__loaded || !pathname) return;
    capturePathOnlyPageview();
  }, [pathname]);
  return null;
}

/** Tie the PostHog person to the Supabase user: identify on login, reset on logout. */
function IdentityTracker() {
  useEffect(() => {
    const supabase = createBrowserClient();
    const sync = (session: Session | null) => {
      if (!posthog.__loaded) return;
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
  // Consent lives in a cookie, readable only client-side — so start disabled
  // and resolve in an effect; SSR and the first client render stay identical.
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    if (!KEY) return;
    const apply = (consent: ConsentValue | null) => {
      if (consent === "granted") {
        startPostHog();
        setEnabled(true);
      } else {
        stopPostHog();
        setEnabled(false);
      }
    };
    apply(readConsent());
    const onChange = (e: Event) => apply((e as CustomEvent<ConsentValue>).detail);
    window.addEventListener(CONSENT_CHANGE_EVENT, onChange);
    return () => window.removeEventListener(CONSENT_CHANGE_EVENT, onChange);
  }, []);

  if (!KEY || !enabled) return <>{children}</>;
  return (
    <PHProvider client={posthog}>
      <PageviewTracker />
      <IdentityTracker />
      {children}
    </PHProvider>
  );
}
