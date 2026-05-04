/**
 * Admin authentication helper.
 *
 * Two layers of protection so we never accidentally expose admin pages:
 *   1. ADMIN_EMAILS env var (comma-separated). Read at request time.
 *      Fast path for bootstrap before any user has the is_admin flag.
 *   2. user_profiles.is_admin = TRUE. The durable, in-DB allow-list
 *      we'll mostly use once seeded.
 *
 * Returns the user id when admin, null otherwise. Routes that need
 * to fail closed call this and return 401 on null.
 */
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";

export interface AdminContext {
  userId: string;
  email: string | null;
  via: "env" | "db";
}

function envAdminEmails(): string[] {
  const raw = process.env.ADMIN_EMAILS ?? "";
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export async function requireAdmin(): Promise<AdminContext | null> {
  let userId: string | null = null;
  let email: string | null = null;
  try {
    const sb = await createServerClient();
    const { data: { user } } = await sb.auth.getUser();
    userId = user?.id ?? null;
    email = (user?.email ?? null)?.toLowerCase() ?? null;
  } catch {
    return null;
  }
  if (!userId) return null;

  // Fast path — env allow-list
  if (email && envAdminEmails().includes(email)) {
    return { userId, email, via: "env" };
  }

  // Durable path — DB flag
  try {
    const admin = getSupabaseAdmin();
    const { data } = await admin
      .from("user_profiles")
      .select("is_admin")
      .eq("user_id", userId)
      .maybeSingle();
    if (data?.is_admin === true) {
      return { userId, email, via: "db" };
    }
  } catch {
    /* fall through */
  }

  return null;
}
