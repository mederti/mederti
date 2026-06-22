import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

// 15-min edge cache — articles are written once a day by the cron job, so
// stale-while-revalidate is comfortable here.
export const revalidate = 900;

interface ArticleCardOut {
  slug: string;
  category: string;
  title: string;
  summary: string;
  date: string;          // ISO date for the client to format
  read_time: string;
  tag: string;
  tag_tone: "high" | "regulatory" | "seasonal" | "neutral";
}

const FALLBACK_TAG_TONE: Record<string, ArticleCardOut["tag_tone"]> = {
  "Supply Chain": "high",
  "Regulatory": "regulatory",
  "Manufacturing": "seasonal",
  "Policy": "neutral",
  "Market": "neutral",
};

/**
 * GET /api/intelligence/latest?limit=3
 *
 * Returns the most recently-published intelligence articles in a shape
 * the chat sidebar IntelligenceView can render directly.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 3), 1), 12);

  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("intelligence_articles")
    .select("slug, title, description, category, read_time, published_at, body_json")
    .eq("status", "published")
    .order("published_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("intelligence/latest error:", error.message);
    return NextResponse.json({ articles: [], error: "Internal error" }, { status: 500 });
  }

  const articles: ArticleCardOut[] = (data ?? []).map((row) => {
    const body = (row.body_json ?? {}) as {
      tag?: string;
      tag_tone?: ArticleCardOut["tag_tone"];
      category_label?: string;
    };
    const categoryLabel = body.category_label ?? row.category ?? "Analysis";
    return {
      slug: row.slug,
      category: categoryLabel,
      title: row.title,
      summary: row.description,
      date: row.published_at ?? new Date().toISOString(),
      read_time: row.read_time ?? "4 min read",
      tag: body.tag ?? categoryLabel,
      tag_tone: body.tag_tone ?? FALLBACK_TAG_TONE[categoryLabel] ?? "neutral",
    };
  });

  return NextResponse.json({ articles });
}
