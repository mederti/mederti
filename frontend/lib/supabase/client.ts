import { createBrowserClient as createSSRBrowserClient } from "@supabase/ssr";

/**
 * createBrowserClient — Supabase client for use in Client Components.
 * Uses the public anon key; session state is persisted in cookies.
 */
export function createBrowserClient() {
  return createSSRBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
