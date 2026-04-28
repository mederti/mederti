import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

async function getAuthUserId(): Promise<{ id: string; email: string | null } | null> {
  try {
    const supabase = await createServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    return { id: user.id, email: user.email ?? null };
  } catch {
    return null;
  }
}

/* GET: return supplier profile for the logged-in user, or null if not yet set up */
export async function GET() {
  const auth = await getAuthUserId();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("supplier_profiles")
    .select("*")
    .eq("user_id", auth.id)
    .maybeSingle();

  if (error) {
    console.error("supplier/profile GET error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ profile: data ?? null });
}

/* POST: create or update supplier profile */
export async function POST(req: Request) {
  const auth = await getAuthUserId();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const company_name = (body.company_name || "").trim();
  if (!company_name) {
    return NextResponse.json({ error: "company_name required" }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  const payload = {
    user_id: auth.id,
    company_name,
    contact_email: body.contact_email || auth.email || "",
    contact_phone: body.contact_phone || null,
    website: body.website || null,
    countries_served: Array.isArray(body.countries_served) ? body.countries_served : [],
    description: body.description || null,
  };

  const { data, error } = await admin
    .from("supplier_profiles")
    .upsert(payload, { onConflict: "user_id" })
    .select()
    .single();

  if (error) {
    console.error("supplier/profile POST error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ profile: data });
}
