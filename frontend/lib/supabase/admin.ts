import { createClient, SupabaseClient } from "@supabase/supabase-js";

/**
 * Supabase admin client for API Route Handlers.
 * Uses the service-role key to bypass RLS — server-side only.
 * Lazy-initialized to avoid failing during build when env vars aren't set.
 */
let _client: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  if (!_client) {
    _client = createClient(
      process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _client;
}
