// ── Shared per-IP rate limiter for public /api/* data routes ──────────────
//
// Why this exists: every data route except /api/chat was unauthenticated AND
// unthrottled, so a script could loop /api/search or /api/bulk-lookup to clone
// the dataset. This caps request volume per IP, per route-tier.
//
// Two backends, chosen at runtime:
//   • Upstash Redis (REST) — DURABLE + shared across Vercel regions/instances.
//     Enabled when UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN are set.
//     Uses a fixed-window counter (INCR + EXPIRE) via the REST pipeline API —
//     no SDK dependency, just fetch.
//   • In-memory Map — per-instance fallback when Upstash isn't configured.
//     Resets on cold start and isn't shared across regions, so it only stops
//     trivial single-instance abuse. Good enough as a floor; set up Upstash
//     for real enforcement.
//
// Fail-OPEN: if the Redis call errors, we allow the request rather than break
// the site. Availability of the product beats perfect enforcement.

import { NextResponse } from "next/server";
import { getClientIp } from "@/lib/chat/rate-limit";

export type RateTier = "search" | "browse" | "strict" | "bulk" | "chat";

// limit = requests permitted per `windowSec` window, per IP, per tier.
const TIERS: Record<RateTier, { limit: number; windowSec: number }> = {
  // Interactive typeahead / search — generous, humans fire these fast.
  search: { limit: 90, windowSec: 60 },
  // Listing / browsing endpoints (shortages, recalls, market-data).
  browse: { limit: 120, windowSec: 60 },
  // Heavier aggregate endpoints (supplier directory, resilience, pipeline).
  strict: { limit: 40, windowSec: 60 },
  // Expensive bulk matchers (bulk-lookup, resolve-drug-names) — the clone
  // vector. Deliberately tight; legit pharmacy uploads are occasional.
  bulk: { limit: 12, windowSec: 60 },
  // /api/chat — the one route that spends real Anthropic money per call
  // (Sonnet + web_search). Hourly cap, DURABLE + cross-region (the in-memory
  // limiter it replaced reset on cold start and was per-instance).
  chat: { limit: 30, windowSec: 3600 },
};

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const upstashEnabled = Boolean(UPSTASH_URL && UPSTASH_TOKEN);

// ── In-memory fixed-window fallback ───────────────────────────────────────
type Bucket = { count: number; resetAt: number };
const memBuckets = new Map<string, Bucket>();

function checkMemory(key: string, limit: number, windowSec: number) {
  const now = Date.now();
  let b = memBuckets.get(key);
  if (!b || b.resetAt <= now) {
    b = { count: 0, resetAt: now + windowSec * 1000 };
    memBuckets.set(key, b);
  }
  b.count += 1;
  return { ok: b.count <= limit, remaining: Math.max(0, limit - b.count), resetAt: b.resetAt };
}

// Opportunistic cleanup so the Map can't grow unbounded on a long-lived
// instance. Cheap: only sweeps when the Map gets large.
function maybeSweepMemory() {
  if (memBuckets.size < 5000) return;
  const now = Date.now();
  for (const [k, v] of memBuckets) if (v.resetAt <= now) memBuckets.delete(k);
}

// ── Upstash REST fixed-window ─────────────────────────────────────────────
// One round-trip pipeline: INCR the window key, and EXPIRE it on first hit.
async function checkUpstash(key: string, limit: number, windowSec: number) {
  const windowStart = Math.floor(Date.now() / 1000 / windowSec) * windowSec;
  const redisKey = `rl:${key}:${windowStart}`;
  const resetAt = (windowStart + windowSec) * 1000;

  const res = await fetch(`${UPSTASH_URL}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${UPSTASH_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify([
      ["INCR", redisKey],
      ["EXPIRE", redisKey, String(windowSec)],
    ]),
    // Never let the limiter hang a request.
    signal: AbortSignal.timeout(800),
  });
  if (!res.ok) throw new Error(`upstash ${res.status}`);
  const out = (await res.json()) as Array<{ result: number }>;
  const count = Number(out?.[0]?.result ?? 0);
  return { ok: count <= limit, remaining: Math.max(0, limit - count), resetAt };
}

/**
 * Enforce the rate limit for `tier` against the caller's IP.
 * Returns a ready-to-return 429 NextResponse when over the limit, or `null`
 * when the request may proceed. Always attach nothing on the happy path —
 * callers just do: `const limited = await enforceRateLimit(req, "bulk"); if (limited) return limited;`
 */
export async function enforceRateLimit(
  req: Request,
  tier: RateTier,
): Promise<NextResponse | null> {
  const { limit, windowSec } = TIERS[tier];
  const ip = getClientIp(req);
  const key = `${tier}:${ip}`;

  let verdict: { ok: boolean; remaining: number; resetAt: number };
  if (upstashEnabled) {
    try {
      verdict = await checkUpstash(key, limit, windowSec);
    } catch {
      // Fail open on Redis trouble — don't take the site down to throttle.
      verdict = { ok: true, remaining: limit, resetAt: Date.now() + windowSec * 1000 };
    }
  } else {
    maybeSweepMemory();
    verdict = checkMemory(key, limit, windowSec);
  }

  if (verdict.ok) return null;

  const retryAfter = Math.max(1, Math.ceil((verdict.resetAt - Date.now()) / 1000));
  return NextResponse.json(
    { error: "Rate limit exceeded. Slow down and try again shortly." },
    {
      status: 429,
      headers: {
        "Retry-After": String(retryAfter),
        "X-RateLimit-Limit": String(limit),
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": String(Math.ceil(verdict.resetAt / 1000)),
      },
    },
  );
}
