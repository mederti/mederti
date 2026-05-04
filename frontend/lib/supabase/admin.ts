import { createClient, SupabaseClient } from "@supabase/supabase-js";

/**
 * Supabase admin client for API Route Handlers.
 * Uses the service-role key to bypass RLS — server-side only.
 * Lazy-initialized to avoid failing during build when env vars aren't set.
 *
 * Falls back to a placeholder URL/key when env is missing so prerender
 * doesn't crash the entire build. At real runtime, an unconfigured client
 * will fail its first request, but the build can still complete.
 */
let _client: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  if (!_client) {
    const url =
      process.env.SUPABASE_URL ||
      process.env.NEXT_PUBLIC_SUPABASE_URL ||
      "https://placeholder.supabase.co";
    const key =
      process.env.SUPABASE_SERVICE_ROLE_KEY || "placeholder-service-role-key";
    _client = createClient(url, key);
  }
  return _client;
}
