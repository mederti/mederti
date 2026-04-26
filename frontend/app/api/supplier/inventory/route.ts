import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

async function getAuthUserId(): Promise<string | null> {
  try {
    const supabase = await createServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    return user?.id ?? null;
  } catch {
    return null;
  }
}

async function getSupplierId(userId: string): Promise<string | null> {
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from("supplier_profiles")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

/** GET — return all inventory entries for the logged-in supplier */
export async function GET() {
  const userId = await getAuthUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supplierId = await getSupplierId(userId);
  if (!supplierId) return NextResponse.json({ inventory: [], profile_required: true });

  const admin = getSupabaseAdmin();
  const { data: rows, error } = await admin
    .from("supplier_inventory")
    .select("id, drug_id, countries, quantity_available, unit_price, currency, pack_size, notes, available_until, status, updated_at")
    .eq("supplier_id", supplierId)
    .order("updated_at", { ascending: false });

  if (error) {
    console.error("supplier/inventory GET error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Decorate with drug names
  const drugIds = (rows ?? []).map((r: { drug_id: string }) => r.drug_id);
  const nameMap = new Map<string, string>();
  if (drugIds.length > 0) {
    const { data: drugs } = await admin
      .from("drugs")
      .select("id, generic_name")
      .in("id", drugIds);
    for (const d of drugs ?? []) {
      nameMap.set((d as { id: string }).id, (d as { generic_name: string }).generic_name);
    }
  }

  return NextResponse.json({
    inventory: (rows ?? []).map((r) => ({
      ...r,
      drug_name: nameMap.get((r as { drug_id: string }).drug_id) ?? "Unknown",
    })),
  });
}

/** POST — add or update an inventory line */
export async function POST(req: Request) {
  const userId = await getAuthUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supplierId = await getSupplierId(userId);
  if (!supplierId) {
    return NextResponse.json(
      { error: "Set up your supplier profile first." },
      { status: 400 },
    );
  }

  const body = await req.json();
  if (!body.drug_id) {
    return NextResponse.json({ error: "drug_id required" }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  const payload = {
    supplier_id: supplierId,
    drug_id: body.drug_id,
    countries: Array.isArray(body.countries) ? body.countries : [],
    quantity_available: body.quantity_available || null,
    unit_price: body.unit_price ? Number(body.unit_price) : null,
    currency: body.currency || "AUD",
    pack_size: body.pack_size || null,
    notes: body.notes || null,
    available_until: body.available_until || null,
    status: body.status || "available",
  };

  const { data, error } = await admin
    .from("supplier_inventory")
    .upsert(payload, { onConflict: "supplier_id,drug_id" })
    .select()
    .single();

  if (error) {
    console.error("supplier/inventory POST error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ entry: data });
}

/** DELETE — remove an inventory line */
export async function DELETE(req: Request) {
  const userId = await getAuthUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supplierId = await getSupplierId(userId);
  if (!supplierId) return NextResponse.json({ error: "No supplier profile" }, { status: 400 });

  const body = await req.json();
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const admin = getSupabaseAdmin();
  const { error } = await admin
    .from("supplier_inventory")
    .delete()
    .eq("id", body.id)
    .eq("supplier_id", supplierId);

  if (error) {
    console.error("supplier/inventory DELETE error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
