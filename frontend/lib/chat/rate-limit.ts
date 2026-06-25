// Per-IP token bucket, in-memory. Resets on cold start, which is fine for v0.
// Vercel functions running in different regions don't share state — that's
// also fine; the goal is to stop trivial abuse, not enforce a global quota.

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

const WINDOW_MS = 60 * 60 * 1000; // 1 hour
const LIMIT = 30;

export function checkRateLimit(ip: string): { ok: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  let b = buckets.get(ip);
  if (!b || b.resetAt < now) {
    b = { count: 0, resetAt: now + WINDOW_MS };
    buckets.set(ip, b);
  }
  if (b.count >= LIMIT) {
    return { ok: false, remaining: 0, resetAt: b.resetAt };
  }
  b.count += 1;
  return { ok: true, remaining: LIMIT - b.count, resetAt: b.resetAt };
}

export function getClientIp(req: Request): string {
  // SECURITY: do NOT trust the leftmost X-Forwarded-For token — on Vercel
  // (and most proxies) the client can prepend an arbitrary value, landing
  // each request in a fresh rate-limit bucket and defeating the limiter.
  // Prefer headers set by the Vercel edge, which the client cannot forge:
  //   • x-real-ip               — single trustworthy client IP
  //   • x-vercel-forwarded-for  — Vercel's own forwarded chain
  // Fall back to the LAST token of x-forwarded-for (Vercel appends the real
  // connecting IP), never the first.
  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp.trim();

  const vercelFwd = req.headers.get("x-vercel-forwarded-for");
  if (vercelFwd) {
    const parts = vercelFwd.split(",");
    return parts[parts.length - 1].trim();
  }

  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",");
    return parts[parts.length - 1].trim();
  }

  return "unknown";
}
