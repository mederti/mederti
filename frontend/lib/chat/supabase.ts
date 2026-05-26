// Thin re-export so the prototype's getSupabase() matches the main site's
// service-role admin client. Same lazy-initialized instance is reused.
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { SupabaseClient } from "@supabase/supabase-js";

export function getSupabase(): SupabaseClient {
  return getSupabaseAdmin();
}
