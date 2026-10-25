"use client";

import { useSyncExternalStore, type ReactNode } from "react";

// @supabase/ssr keeps the browser session in a readable `sb-<ref>-auth-token`
// cookie (chunked as `.0`, `.1`… when large). Presence is enough here — this
// only picks loading chrome, it is not an auth check.
const hasSessionCookie = () => /(?:^|;\s*)sb-[^=]+-auth-token(?:\.\d+)?=/.test(document.cookie);
const noop = () => () => {};

/**
 * Renders `signedIn` when the browser holds a Supabase session cookie, else
 * `signedOut`. Synchronous on client navigations (no flash); on a hard load the
 * server render uses `signedOut` and hydration corrects it.
 */
export default function SignedInSwitch({ signedIn, signedOut }: { signedIn: ReactNode; signedOut: ReactNode }) {
  const isSignedIn = useSyncExternalStore(noop, hasSessionCookie, () => false);
  return <>{isSignedIn ? signedIn : signedOut}</>;
}
