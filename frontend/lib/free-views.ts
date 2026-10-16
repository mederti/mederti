/**
 * Anonymous free-view meter.
 *
 * Signed-out visitors can open FREE_VIEW_LIMIT distinct drug pages before we
 * ask them to sign up (Oct 2026 decision: replaces the hard login wall from
 * PR #152). Search stays free; only drug-detail views are counted, and
 * re-opening a drug already viewed doesn't burn another view.
 *
 * State lives in one HMAC-signed, httpOnly cookie holding the viewed drug IDs.
 * Split responsibilities:
 *   - proxy.ts ENFORCES: an anonymous request for a drug not yet viewed, with
 *     the meter full, is sent to /signup.
 *   - /api/free-views COUNTS: a beacon fired by the rendered drug page. Doing
 *     it here rather than in the proxy is deliberate — Next strips the
 *     prefetch headers before middleware runs, so the proxy can't tell a
 *     <Link> prefetch from a real view and would burn views on hover/scroll.
 *     (A catalogue id that 308s to its canonical drug never renders, so it
 *     isn't counted either.)
 * Clearing cookies resets the meter — accepted: this is a conversion nudge,
 * not DRM. Scraping protection is the per-IP rate limiter + revoked anon
 * PostgREST access, not this.
 *
 * Uses Web Crypto only, so it runs in the proxy (middleware) runtime.
 */

export const FREE_VIEW_LIMIT = 10;
export const FREE_VIEW_COOKIE = "mederti_fv";
/** Request header the proxy sets so server components can read the count. */
export const FREE_VIEW_HEADER = "x-mederti-free-views";
/** JS-readable mirror of the count, for client components' banner only (never trusted). */
export const FREE_VIEW_COUNT_COOKIE = "mederti_fv_n";
const MAX_AGE = 60 * 60 * 24 * 365;

function secret(): string {
  return (
    process.env.FREE_VIEW_SECRET ??
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    "mederti-dev-free-view-secret"
  );
}

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): string {
  return atob(s.replace(/-/g, "+").replace(/_/g, "/"));
}

async function sign(payload: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  return b64url(new Uint8Array(mac));
}

/** Viewed drug IDs from the cookie; [] when missing, tampered or malformed. */
export async function readFreeViews(raw: string | undefined): Promise<string[]> {
  if (!raw) return [];
  const dot = raw.lastIndexOf(".");
  if (dot <= 0) return [];
  const payload = raw.slice(0, dot);
  if ((await sign(payload)) !== raw.slice(dot + 1)) return [];
  try {
    const ids = JSON.parse(fromB64url(payload));
    return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export async function writeFreeViews(ids: string[]): Promise<string> {
  const payload = b64url(new TextEncoder().encode(JSON.stringify(ids)));
  return `${payload}.${await sign(payload)}`;
}

export const freeViewCountCookieOptions = {
  path: "/",
  maxAge: MAX_AGE,
  sameSite: "lax" as const,
};

export const freeViewCookieOptions = {
  path: "/",
  maxAge: MAX_AGE,
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
};

/**
 * Meter decision for one anonymous drug view.
 * - already viewed → allowed, unchanged
 * - under the limit → allowed, id appended
 * - at the limit   → blocked
 */
export function meterDrugView(
  viewed: string[],
  drugId: string,
): { allowed: boolean; viewed: string[]; changed: boolean } {
  if (viewed.includes(drugId)) return { allowed: true, viewed, changed: false };
  if (viewed.length >= FREE_VIEW_LIMIT) return { allowed: false, viewed, changed: false };
  return { allowed: true, viewed: [...viewed, drugId], changed: true };
}
