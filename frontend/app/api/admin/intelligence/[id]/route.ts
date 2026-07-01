import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin-auth";
import { serverError } from "@/lib/security/errors";

/**
 * GET /api/admin/intelligence/[id]
 * Fetch full article including body_json and source_data for preview.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;

  const { data, error } = await getSupabaseAdmin()
    .from("intelligence_articles")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return serverError(error, "load intelligence article");
  }
  return NextResponse.json(data);
}
