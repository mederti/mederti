import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin-auth";

/**
 * GET /api/admin/intelligence?status=draft&page=1
 * List intelligence articles for admin review.
 */
export async function GET(req: NextRequest) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const sp = req.nextUrl.searchParams;
  const status = sp.get("status");
  const page = Math.max(1, Number(sp.get("page") ?? 1));
  const pageSize = 20;
  const offset = (page - 1) * pageSize;

  let query = getSupabaseAdmin()
    .from("intelligence_articles")
    .select(
      "id, slug, title, description, category, content_type, status, drug_name, author, read_time, created_at, published_at",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .range(offset, offset + pageSize - 1);

  if (status && ["draft", "published", "rejected"].includes(status)) {
    query = query.eq("status", status);
  }

  const { data, count, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ articles: data ?? [], total: count ?? 0, page, pageSize });
}

/**
 * PATCH /api/admin/intelligence  body: { id, action: "publish"|"reject", reviewerEmail? }
 * Publish or reject a draft article.
 */
export async function PATCH(req: NextRequest) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = await req.json();
  const { id, action, reviewerEmail } = body as {
    id?: string;
    action?: string;
    reviewerEmail?: string;
  };

  if (!id || !action || !["publish", "reject"].includes(action)) {
    return NextResponse.json(
      { error: "id and action (publish|reject) required" },
      { status: 400 },
    );
  }

  const updates: Record<string, unknown> = {
    status: action === "publish" ? "published" : "rejected",
  };
  if (action === "publish") {
    updates.published_at = new Date().toISOString();
  } else {
    updates.rejected_at = new Date().toISOString();
  }
  if (reviewerEmail) {
    updates.reviewed_by = reviewerEmail;
  }

  const { error } = await getSupabaseAdmin()
    .from("intelligence_articles")
    .update(updates)
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
