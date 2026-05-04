import { createBrowserClient as createSSRBrowserClient } from "@supabase/ssr";

/**
 * createBrowserClient — Supabase client for use in Client Components.
 * Uses the public anon key; session state is persisted in cookies.
 *
 * Falls back to a benign placeholder URL when env vars aren't set so
 * Next.js prerender doesn't crash. At true runtime the env vars must
 * be set or auth calls will fail — but the build will succeed and the
 * server can boot.
 */
export function createBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder-anon-key";
  return createSSRBrowserClient(url, key);
}
