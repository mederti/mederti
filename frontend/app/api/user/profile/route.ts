import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// Mirrors the CHECK constraints in migration 025_user_profile_onboarding.sql.
const VALID_ROLES = [
  "hospital_pharmacist",
  "community_pharmacist",
  "hospital_procurement",
  "wholesaler",
  "manufacturer",
  "government",
  "researcher",
  // back-compat
  "pharmacist", "hospital", "supplier", "default", "other",
];

const VALID_USE_CASES = [
  "find_alternative",
  "plan_ahead",
  "sell_or_source",
  "analyse_market",
  "just_exploring",
];

const VALID_ORG_SIZES = [
  "just_me", "2_10", "11_50", "51_250", "251_1000", "1000_plus",
];

const VALID_THERAPY_AREAS = [
  "oncology",
  "cardiovascular_metabolic",
  "anti_infectives",
  "cns_mental_health",
  "respiratory",
  "anaesthesia_critical_care",
  "endocrine_hormones",
  "other",
];

interface ProfileBody {
  role?: string;
  countries?: string[];
  use_case?: string;
  org_size?: string | null;
  therapy_areas?: string[];
  company_name?: string | null;
  // Internal: when set, also flips onboarding_done.
  complete_onboarding?: boolean;
}

async function getUserId(): Promise<string | null> {
  try {
    const sb = await createServerClient();
    const { data: { user } } = await sb.auth.getUser();
    return user?.id ?? null;
  } catch {
    return null;
  }
}

/** GET — return the current user's profile (or null if no row yet). */
export async function GET() {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("user_profiles")
    .select(
      "role, countries, use_case, org_size, therapy_areas, company_name, onboarding_done, onboarding_done_at, created_at"
    )
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ profile: data });
}

/**
 * POST — upsert the current user's profile.
 *
 * Body fields are all optional; only the ones provided are written. Pass
 * `complete_onboarding: true` to flip the onboarding-complete flag (used
 * at the end of the multi-step onboarding flow).
 */
export async function POST(req: Request) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: ProfileBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Sanitise / validate
  const update: Record<string, unknown> = { user_id: userId };

  if (body.role !== undefined) {
    if (!VALID_ROLES.includes(body.role)) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }
    update.role = body.role;
  }

  if (body.countries !== undefined) {
    if (!Array.isArray(body.countries)) {
      return NextResponse.json({ error: "countries must be an array" }, { status: 400 });
    }
    // Keep only ISO-2 looking codes (max 5)
    update.countries = body.countries
      .filter((c): c is string => typeof c === "string" && /^[A-Za-z]{2,3}$/.test(c))
      .slice(0, 5)
      .map((c) => c.toUpperCase());
  }

  if (body.use_case !== undefined) {
    if (body.use_case && !VALID_USE_CASES.includes(body.use_case)) {
      return NextResponse.json({ error: "Invalid use_case" }, { status: 400 });
    }
    update.use_case = body.use_case || null;
  }

  if (body.org_size !== undefined) {
    if (body.org_size && !VALID_ORG_SIZES.includes(body.org_size)) {
      return NextResponse.json({ error: "Invalid org_size" }, { status: 400 });
    }
    update.org_size = body.org_size || null;
  }

  if (body.therapy_areas !== undefined) {
    if (!Array.isArray(body.therapy_areas)) {
      return NextResponse.json({ error: "therapy_areas must be an array" }, { status: 400 });
    }
    update.therapy_areas = body.therapy_areas
      .filter((t): t is string => typeof t === "string" && VALID_THERAPY_AREAS.includes(t))
      .slice(0, 8);
  }

  if (body.company_name !== undefined) {
    update.company_name = body.company_name?.trim()?.slice(0, 200) || null;
  }

  if (body.complete_onboarding) {
    update.onboarding_done = true;
    update.onboarding_done_at = new Date().toISOString();
  }

  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("user_profiles")
    .upsert(update, { onConflict: "user_id" })
    .select()
    .maybeSingle();

  if (error) {
    console.error("user/profile POST error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true, profile: data });
}
