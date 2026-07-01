import { NextResponse } from "next/server";
import { serverError } from "@/lib/security/errors";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";
import { isValidProfileRole } from "@/lib/roles";

export const dynamic = "force-dynamic";

/** POST: set role for the logged-in user */
export async function POST(req: Request) {
  let userId: string | null = null;
  try {
    const supabase = await createServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    userId = user?.id ?? null;
  } catch {
    // fall through
  }
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { role } = await req.json();
  if (!isValidProfileRole(role)) {
    return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  const { error } = await admin
    .from("user_profiles")
    .upsert({ user_id: userId, role }, { onConflict: "user_id" });

  if (error) {
    console.error("user/role POST error:", error);
    return serverError(error);
  }
  return NextResponse.json({ success: true, role });
}
