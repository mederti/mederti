"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { CONSENT_CHANGE_EVENT, readConsent, type ConsentValue } from "@/lib/consent";

/**
 * Google tag (gtag.js) for Google Ads — conversion tracking and remarketing.
 *
 * Same posture as the PostHog provider (lib/analytics/posthog-provider.tsx):
 *   • CONSENT-GATED: the gtag.js script is not injected at all until the user
 *     accepts cookies in the CookieConsent banner. A Google Ads tag writes
 *     advertising cookies (_gcl_au, and _ga if Analytics is linked), so under
 *     GDPR/ePrivacy it cannot be a "load on every page unconditionally" tag —
 *     prior consent is required, and the banner is the only lawful gate.
 *   • Withdrawing consent flips Consent Mode to denied and deletes the
 *     cookies Google set on this device.
 *   • PAGE PATH ONLY: page_location is rewritten to origin + pathname, so
 *     query strings (e.g. /search?q=<drug the user is looking for>) never
 *     reach Google. Same rule the PostHog pageviews follow.
 *
 * The ID is env-overridable but defaults to the account the COO supplied, so
 * the tag works in production without a Vercel env change. Trimmed because
 * prod env values here have carried trailing newlines before.
 */

const TAG_ID = (process.env.NEXT_PUBLIC_GOOGLE_ADS_ID || "AW-18419740186").trim();

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

/** Push to the queue directly — safe before gtag.js has finished loading. */
function gtag(...args: unknown[]) {
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push(args);
}

function pagePathOnly() {
  return window.location.origin + window.location.pathname;
}

/** Delete the cookies Google Ads / Analytics set on this device. */
function clearGoogleCookies() {
  try {
    const host = window.location.hostname;
    for (const raw of document.cookie.split("; ")) {
      const name = raw.split("=")[0];
      if (!/^(_ga|_gcl_|_gac_)/.test(name)) continue;
      // Expire under both scopes gtag may have used (host-only and
      // cross-subdomain); an unmatched domain attribute is a harmless no-op.
      document.cookie = `${name}=;path=/;max-age=0`;
      document.cookie = `${name}=;path=/;max-age=0;domain=.${host}`;
    }
  } catch {
    /* cookies unavailable (private mode etc.) — nothing to clear */
  }
}

/** Re-send a page_view on every App Router navigation (path only). */
function PageviewTracker() {
  const pathname = usePathname();
  // The gtag `config` call already sends a page_view for the page the tag
  // loaded on, so skip this effect's first run or that view is double-counted.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!pathname || !window.dataLayer) return;
    gtag("event", "page_view", {
      send_to: TAG_ID,
      page_location: pagePathOnly(),
      page_path: pathname,
    });
  }, [pathname]);
  return null;
}

export function GoogleTag() {
  // Consent lives in a cookie, readable only client-side — start disabled and
  // resolve in an effect so SSR and the first client render stay identical.
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    if (!TAG_ID) return;
    const apply = (consent: ConsentValue | null) => {
      if (consent === "granted") {
        setEnabled(true);
        // If gtag.js is already on the page from an earlier grant in this
        // pageload, re-grant via Consent Mode rather than reloading it.
        if (window.dataLayer) {
          gtag("consent", "update", {
            ad_storage: "granted",
            ad_user_data: "granted",
            ad_personalization: "granted",
            analytics_storage: "granted",
          });
        }
      } else {
        setEnabled(false);
        if (window.dataLayer) {
          gtag("consent", "update", {
            ad_storage: "denied",
            ad_user_data: "denied",
            ad_personalization: "denied",
            analytics_storage: "denied",
          });
        }
        clearGoogleCookies();
      }
    };
    apply(readConsent());
    const onChange = (e: Event) => apply((e as CustomEvent<ConsentValue>).detail);
    window.addEventListener(CONSENT_CHANGE_EVENT, onChange);
    return () => window.removeEventListener(CONSENT_CHANGE_EVENT, onChange);
  }, []);

  if (!TAG_ID || !enabled) return null;

  return (
    <>
      <Script
        id="gtag-src"
        strategy="afterInteractive"
        src={`https://www.googletagmanager.com/gtag/js?id=${TAG_ID}`}
      />
      <Script id="gtag-init" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('consent', 'default', {
            ad_storage: 'granted',
            ad_user_data: 'granted',
            ad_personalization: 'granted',
            analytics_storage: 'granted'
          });
          gtag('config', '${TAG_ID}', {
            page_location: window.location.origin + window.location.pathname
          });
        `}
      </Script>
      <PageviewTracker />
    </>
  );
}
