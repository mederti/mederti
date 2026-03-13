import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";
import { calculateRiskScore, SEV_RANK } from "@/lib/risk-score";

export const dynamic = "force-dynamic";

const BATCH = 1000;

/** Get authenticated user ID or return 401 */
async function getAuthUserId(): Promise<string | null> {
  try {
    const supabase = await createServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    return user?.id ?? null;
  } catch {
    return null;
  }
}

/* ── GET: list portfolio with risk scores ── */
export async function GET() {
  const userId = await getAuthUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const admin = getSupabaseAdmin();

    // Fetch user's portfolio drugs
    const { data: portfolioRows } = await admin
      .from("supplier_portfolios")
      .select("id, drug_id, notes, added_at")
      .eq("user_id", userId)
      .order("added_at", { ascending: false });

    if (!portfolioRows || portfolioRows.length === 0) {
      return NextResponse.json({ portfolio: [] });
    }

    const drugIds: string[] = portfolioRows.map((r: { drug_id: string }) => r.drug_id);

    // Fetch drug names
    const { data: drugs } = await admin
      .from("drugs")
      .select("id, generic_name")
      .in("id", drugIds);

    const nameMap = new Map((drugs ?? []).map((d: { id: string; generic_name: string }) => [d.id, d.generic_name]));

    // Fetch active shortage_events for these drugs (paginated)
    const shortageRows: Record<string, unknown>[] = [];
    let offset = 0;

    while (true) {
      const { data: batch } = await admin
        .from("shortage_events")
        .select("drug_id, country_code, severity, created_at")
        .in("drug_id", drugIds)
        .in("status", ["active", "anticipated"])
        .range(offset, offset + BATCH - 1);

      const rows = batch ?? [];
      shortageRows.push(...rows);
      if (rows.length < BATCH) break;
      offset += BATCH;
    }

    // Compute risk data per drug
    const now = Date.now();
    const d30 = new Date(now - 30 * 24 * 60 * 60 * 1000).getTime();
    const d60 = new Date(now - 60 * 24 * 60 * 60 * 1000).getTime();

    const drugData = new Map<string, {
      count: number;
      countries: Set<string>;
      maxSev: string;
      last30: number;
      prior30: number;
    }>();

    for (const drugId of drugIds) {
      drugData.set(drugId, { count: 0, countries: new Set(), maxSev: "low", last30: 0, prior30: 0 });
    }

    for (const row of shortageRows) {
      const drugId = row.drug_id as string;
      const entry = drugData.get(drugId);
      if (!entry) continue;

      entry.count++;
      entry.countries.add((row.country_code as string) ?? "XX");

      const sev = ((row.severity as string) ?? "low").toLowerCase();
      if ((SEV_RANK[sev] ?? 0) > (SEV_RANK[entry.maxSev] ?? 0)) {
        entry.maxSev = sev;
      }

      const created = new Date(row.created_at as string).getTime();
      if (created >= d30) entry.last30++;
      else if (created >= d60) entry.prior30++;
    }

    // Build portfolio response
    const portfolio = portfolioRows.map((pRow: { id: string; drug_id: string; notes: string | null; added_at: string }) => {
      const dd = drugData.get(pRow.drug_id)!;
      const risk = calculateRiskScore({
        last30: dd.last30,
        prior30: dd.prior30,
        countryCount: dd.countries.size,
        logEntries: 0,
        escalations: 0,
        maxSev: SEV_RANK[dd.maxSev] ?? 0,
      });

      return {
        id: pRow.id,
        drug_id: pRow.drug_id,
        drug_name: nameMap.get(pRow.drug_id) ?? "Unknown",
        notes: pRow.notes,
        added_at: pRow.added_at,
        risk_score: risk.riskScore,
        risk_level: risk.riskLevel,
        primary_signal: risk.primarySignal,
        active_shortage_count: dd.count,
        countries_affected: [...dd.countries].filter((c) => c !== "XX"),
        max_severity: dd.maxSev,
      };
    });

    return NextResponse.json({ portfolio });
  } catch (err) {
    console.error("supplier/portfolio GET error:", err);
    return NextResponse.json({ portfolio: [], error: "Failed to fetch portfolio" }, { status: 500 });
  }
}

/* ── POST: add drug to portfolio ── */
export async function POST(req: Request) {
  const userId = await getAuthUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await req.json();
    const drugId = body.drug_id as string;
    const notes = (body.notes as string) || null;

    if (!drugId) {
      return NextResponse.json({ error: "drug_id required" }, { status: 400 });
    }

    const admin = getSupabaseAdmin();
    const { error } = await admin
      .from("supplier_portfolios")
      .upsert({ user_id: userId, drug_id: drugId, notes }, { onConflict: "user_id,drug_id" });

    if (error) {
      console.error("supplier/portfolio POST error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("supplier/portfolio POST error:", err);
    return NextResponse.json({ error: "Failed to add to portfolio" }, { status: 500 });
  }
}

/* ── DELETE: remove drug from portfolio ── */
export async function DELETE(req: Request) {
  const userId = await getAuthUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await req.json();
    const drugId = body.drug_id as string;

    if (!drugId) {
      return NextResponse.json({ error: "drug_id required" }, { status: 400 });
    }

    const admin = getSupabaseAdmin();
    const { error } = await admin
      .from("supplier_portfolios")
      .delete()
      .eq("user_id", userId)
      .eq("drug_id", drugId);

    if (error) {
      console.error("supplier/portfolio DELETE error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("supplier/portfolio DELETE error:", err);
    return NextResponse.json({ error: "Failed to remove from portfolio" }, { status: 500 });
  }
}
