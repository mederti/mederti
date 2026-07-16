"use client";

/**
 * Cookie-consent state — the single source of truth for whether optional
 * analytics (PostHog) may run.
 *
 * The choice is stored in a first-party `mederti-consent` cookie. Storing the
 * choice itself needs no consent (it's strictly necessary to honour it).
 * Value format is versioned (`v1:granted` / `v1:denied`) so a future change to
 * what "consent" covers can bump the version and re-prompt everyone.
 *
 * Components coordinate via window events:
 *   CONSENT_CHANGE_EVENT — fired by writeConsent(); the PostHog provider
 *     starts/stops capture, the banner closes.
 *   OPEN_PREFERENCES_EVENT — fired by openCookiePreferences() (footer /
 *     privacy-page links); the banner re-opens so consent can be withdrawn
 *     as easily as it was given.
 */

export type ConsentValue = "granted" | "denied";

const COOKIE_NAME = "mederti-consent";
const CONSENT_VERSION = "v1";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 365; // re-prompt after 12 months

export const CONSENT_CHANGE_EVENT = "mederti:consent-change";
export const OPEN_PREFERENCES_EVENT = "mederti:cookie-preferences";

export function readConsent(): ConsentValue | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(/(?:^|; )mederti-consent=([^;]+)/);
  if (!m) return null;
  const [version, value] = decodeURIComponent(m[1]).split(":");
  if (version !== CONSENT_VERSION) return null; // stale version → re-prompt
  return value === "granted" || value === "denied" ? value : null;
}

export function writeConsent(value: ConsentValue): void {
  document.cookie = `${COOKIE_NAME}=${CONSENT_VERSION}:${value};path=/;max-age=${MAX_AGE_SECONDS};SameSite=Lax`;
  window.dispatchEvent(new CustomEvent(CONSENT_CHANGE_EVENT, { detail: value }));
}

export function openCookiePreferences(): void {
  window.dispatchEvent(new CustomEvent(OPEN_PREFERENCES_EVENT));
}
