// ── Safe API error responses ──────────────────────────────────────────────
//
// Returning a raw Supabase/PostgREST `error.message` to the client leaks
// internal schema (table + column names, constraint names, PostgREST codes),
// which hands an attacker a free map of the database. These helpers log the
// real detail server-side (visible in Vercel logs / Sentry) and return a
// generic, non-revealing message to the caller.

import { NextResponse } from "next/server";

function extractDetail(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object" && "message" in e) {
    return String((e as { message: unknown }).message);
  }
  return String(e);
}

/**
 * Generic 500. Logs the real error (with optional context) and returns a safe
 * body. Usage: `if (error) return serverError(error, "load supplier quotes");`
 */
export function serverError(e: unknown, context?: string): NextResponse {
  console.error(`[api] ${context ?? "server error"}:`, extractDetail(e));
  return NextResponse.json(
    { error: "Something went wrong. Please try again." },
    { status: 500 },
  );
}
