import { createClient, SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/db";

/**
 * Supabase admin client for API Route Handlers.
 * Uses the service-role key to bypass RLS — server-side only.
 * Lazy-initialized to avoid failing during build when env vars aren't set.
 *
 * Falls back to a placeholder URL/key when env is missing so prerender
 * doesn't crash the entire build. At real runtime, an unconfigured client
 * will fail its first request, but the build can still complete.
 *
 * TWO FLAVOURS (audit FINDING-F4-06 incremental adoption):
 *   • getSupabaseAdmin()       — untyped (backward-compat for legacy code)
 *   • getSupabaseAdminTyped()  — types from frontend/types/db.ts (5 hot
 *                                tables strictly typed; the rest fall
 *                                through to Record<string, unknown> via
 *                                the index-signature fallback)
 *
 * New / refactored routes should use the typed flavour. When the Supabase
 * CLI is installed and `npm run db:types` regenerates the full Database
 * type, both flavours produce equivalent clients — at that point the
 * untyped version can be retired.
 */
let _client: SupabaseClient | null = null;
let _typedClient: SupabaseClient<Database> | null = null;

function _resolveCreds() {
  const url =
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    "https://placeholder.supabase.co";
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY || "placeholder-service-role-key";
  return { url, key };
}

export function getSupabaseAdmin(): SupabaseClient {
  if (!_client) {
    const { url, key } = _resolveCreds();
    _client = createClient(url, key);
  }
  return _client;
}

export function getSupabaseAdminTyped(): SupabaseClient<Database> {
  if (!_typedClient) {
    const { url, key } = _resolveCreds();
    _typedClient = createClient<Database>(url, key);
  }
  return _typedClient;
}
