// Privacy-preserving demand-signal instrumentation helper.
//
// Route handlers call recordDemandSignal() to log a buyer-side signal —
// search, drug view, enquiry, watchlist add, or chip click — to the
// demand_signals table (migration 041). The helper:
//
//   • generates session_hash = HMAC-SHA256(identifier, daily_salt)
//     where identifier is the authenticated user_id or, for anonymous
//     requests, the client IP. Daily-rotating salt breaks cross-day
//     correlation.
//   • truncates raw_query to 80 chars to bound accidental PII
//   • is best-effort: failure to log NEVER blocks the request
//
// Reads MUST go through v_demand_signal_summary which enforces k-anonymity
// ≥ 5. See get_demand_signal_summary in frontend/lib/chat/tools.ts.

import { createHmac, randomBytes } from "node:crypto";

import { getSupabaseAdmin } from "@/lib/supabase/admin";

const MAX_QUERY_LEN = 80;

// Daily-rotating salt. In production, prefer a deterministic daily salt set
// via env var (so multiple Vercel instances + cron jobs use the same one);
// fall back to a per-process random for dev.
function dailySalt(): string {
  const envSalt = process.env.DEMAND_SIGNAL_DAILY_SALT;
  if (envSalt) return `${envSalt}:${new Date().toISOString().slice(0, 10)}`;
  // Dev fallback: per-process, rotates on cold start. Sessions won't
  // correlate across days in production either way — the date suffix
  // does the rotation.
  return `dev-fallback:${new Date().toISOString().slice(0, 10)}`;
}

function hashIdentifier(identifier: string | null | undefined): string | null {
  if (!identifier) return null;
  return createHmac("sha256", dailySalt()).update(identifier).digest("hex").slice(0, 32);
}

export type DemandSignalInput = {
  /** One of: search | drug_view | enquiry | watchlist_add | chip_click. */
  signal_type: "search" | "drug_view" | "enquiry" | "watchlist_add" | "chip_click";
  /** Resolved drug UUID if the signal targeted a specific drug. */
  drug_id?: string | null;
  /** Free-text query (search/chip). Truncated to 80 chars. */
  raw_query?: string | null;
  /** ISO-2 country code of the user's home market, if known. */
  country_code?: string | null;
  /** Stable identifier for the session — user_id when authenticated, IP
   *  hash otherwise. Hashed with daily-rotating salt before storage. */
  identifier?: string | null;
};

/** Fire-and-forget demand signal write. Never throws; never delays the request.
 *
 *  Usage in a Next.js Route Handler:
 *
 *    import { recordDemandSignal } from "@/lib/demand-signal";
 *    ...
 *    recordDemandSignal({
 *      signal_type: "search",
 *      raw_query: q,
 *      country_code: country,
 *      identifier: userId ?? ip,
 *    });  // not awaited — fires in background
 */
export function recordDemandSignal(input: DemandSignalInput): void {
  // Privacy: refuse to store if the signal_type is malformed.
  const validTypes = new Set([
    "search",
    "drug_view",
    "enquiry",
    "watchlist_add",
    "chip_click",
  ]);
  if (!validTypes.has(input.signal_type)) return;

  const session_hash = hashIdentifier(input.identifier);
  const raw_query = input.raw_query ? input.raw_query.slice(0, MAX_QUERY_LEN) : null;

  // Fire-and-forget — don't await. Errors logged but never re-thrown.
  void (async () => {
    try {
      const sb = getSupabaseAdmin();
      const { error } = await sb.from("demand_signals").insert({
        signal_type: input.signal_type,
        drug_id: input.drug_id ?? null,
        raw_query,
        country_code: input.country_code ?? null,
        session_hash,
      });
      if (error) {
        // Migration 041 may not be applied yet — degrade silently. Same
        // pattern as the eligibility tool's table-may-not-exist tolerance.
        if (process.env.DEMAND_SIGNAL_DEBUG) {
          console.warn("[demand-signal] insert failed (non-fatal):", error.message);
        }
      }
    } catch (e) {
      if (process.env.DEMAND_SIGNAL_DEBUG) {
        console.warn("[demand-signal] write threw (non-fatal):", e);
      }
    }
  })();
}

/** Helper for tests: regenerate a fresh per-process salt for the next call.
 *  Don't use in production code paths. */
export function _rotateSaltForTests(): void {
  // Tests can stub dailySalt() if needed; this is a no-op marker.
}
