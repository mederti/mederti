import { createServerClient as createSSRServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * createServerClient — Supabase client for use in Server Components and Route Handlers.
 * Reads/writes the auth session from Next.js cookies.
 */
export async function createServerClient() {
  const cookieStore = await cookies();

  return createSSRServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Silently ignored when called from a Server Component
            // (cookies can only be set from Server Actions or Route Handlers)
          }
        },
      },
    }
  );
}
