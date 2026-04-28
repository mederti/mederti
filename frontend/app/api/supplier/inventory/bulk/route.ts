import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

async function getAuthUserId(): Promise<string | null> {
  try {
    const sb = await createServerClient();
    const { data: { user } } = await sb.auth.getUser();
    return user?.id ?? null;
  } catch {
    return null;
  }
}

interface BulkRow {
  drug_name?: string;
  drug_id?: string;
  quantity_available?: string;
  unit_price?: string | number;
  currency?: string;
  pack_size?: string;
  countries?: string; // comma-separated codes
  notes?: string;
  available_until?: string;
}

/**
 * POST /api/supplier/inventory/bulk
 *
 * Body: { rows: BulkRow[] }
 *
 * Resolves drug names to drug_ids, then upserts each row.
 * Returns per-row status: created/updated/error/unmatched.
 */
export async function POST(req: Request) {
  const userId = await getAuthUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = getSupabaseAdmin();
  const { data: profile } = await admin
    .from("supplier_profiles")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();

  if (!profile) {
    return NextResponse.json({ error: "Set up supplier profile first" }, { status: 400 });
  }
  const supplierId = (profile as { id: string }).id;

  const body = await req.json();
  const rows: BulkRow[] = Array.isArray(body.rows) ? body.rows : [];
  if (rows.length === 0) {
    return NextResponse.json({ error: "No rows to import" }, { status: 400 });
  }
  if (rows.length > 500) {
    return NextResponse.json({ error: "Max 500 rows per import" }, { status: 400 });
  }

  // Pre-fetch drugs to resolve by generic_name
  const namesToResolve = rows.filter(r => !r.drug_id && r.drug_name).map(r => r.drug_name!.trim().toLowerCase());
  const nameToId = new Map<string, string>();
  if (namesToResolve.length > 0) {
    // Try exact match first via the in() filter on lowercased generic_name
    const uniqueNames = Array.from(new Set(namesToResolve));
    // Search 50 at a time
    for (let i = 0; i < uniqueNames.length; i += 50) {
      const batch = uniqueNames.slice(i, i + 50);
      // Use ilike for fuzzy match per name
      for (const name of batch) {
        const { data } = await admin
          .from("drugs")
          .select("id, generic_name")
          .ilike("generic_name", name)
          .limit(1);
        if (data && data.length > 0) {
          nameToId.set(name, (data[0] as { id: string }).id);
        }
      }
    }
  }

  const results: Array<{ row: number; status: string; drug?: string; message?: string }> = [];
  let created = 0;
  let updated = 0;
  let errors = 0;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    let drugId = r.drug_id;
    if (!drugId && r.drug_name) {
      drugId = nameToId.get(r.drug_name.trim().toLowerCase());
    }
    if (!drugId) {
      results.push({ row: i + 1, status: "unmatched", drug: r.drug_name, message: "Drug not found in catalogue" });
      errors++;
      continue;
    }

    const countries = r.countries
      ? r.countries.split(/[,;|]/).map(s => s.trim().toUpperCase()).filter(Boolean)
      : [];

    const payload = {
      supplier_id: supplierId,
      drug_id: drugId,
      countries,
      quantity_available: r.quantity_available || null,
      unit_price: r.unit_price ? Number(r.unit_price) : null,
      currency: r.currency || "AUD",
      pack_size: r.pack_size || null,
      notes: r.notes || null,
      available_until: r.available_until || null,
      status: "available",
    };

    try {
      const { data, error } = await admin
        .from("supplier_inventory")
        .upsert(payload, { onConflict: "supplier_id,drug_id" })
        .select("id")
        .single();
      if (error) {
        results.push({ row: i + 1, status: "error", drug: r.drug_name, message: error.message });
        errors++;
      } else {
        results.push({ row: i + 1, status: "saved", drug: r.drug_name });
        created++;
      }
    } catch (e) {
      results.push({ row: i + 1, status: "error", drug: r.drug_name, message: String(e) });
      errors++;
    }
  }

  return NextResponse.json({
    summary: { total: rows.length, saved: created, errors, unmatched: results.filter(r => r.status === "unmatched").length },
    results,
  });
}
