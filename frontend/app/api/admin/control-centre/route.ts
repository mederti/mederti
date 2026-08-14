import { NextResponse } from "next/server";
import { serverError } from "@/lib/security/errors";
import { requireAdmin } from "@/lib/admin-auth";
import { getControlCentreData } from "@/lib/admin/control-centre-data";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/control-centre
 *
 * Admin-gated aggregation feed for /admin/control-centre. All logic lives
 * in lib/admin/control-centre-data.ts.
 */
export async function GET() {
  const ctx = await requireAdmin();
  if (!ctx) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    return NextResponse.json(await getControlCentreData());
  } catch (e) {
    return serverError(e as Error);
  }
}
