import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

// 15-min edge cache — article bodies are written once a day by the cron job.
export const revalidate = 900;

interface Section {
  heading?: string;
  body: string;
}

type TagTone = "high" | "regulatory" | "seasonal" | "neutral";

const FALLBACK_TAG_TONE: Record<string, TagTone> = {
  "Supply Chain": "high",
  Regulatory: "regulatory",
  Manufacturing: "seasonal",
  Policy: "neutral",
  Market: "neutral",
};

/**
 * GET /api/intelligence/article/[slug]
 *
 * Returns the full body of a published intelligence article, in a shape the
 * chat reading layout (ArticleReader + ArticleChat) can render and ground a
 * conversation in. `sections` carries the structured heading/body blocks for
 * display; `body_text` is the flattened plain text used to ground the chat.
 *
 * 404s when the slug isn't a published DB article — callers fall back to the
 * summary they already hold from the card.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const sb = getSupabaseAdmin();

  const { data, error } = await sb
    .from("intelligence_articles")
    .select(
      "slug, title, description, category, author, read_time, published_at, body_json, drug_id, drug_name, pull_quote"
    )
    .eq("slug", slug)
    .eq("status", "published")
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // body_json is an array of { heading?, body } sections (see the SSR slug
  // page). Be defensive: tolerate a non-array (older/odd rows) by coercing
  // to an empty section list so we still return clean metadata.
  const rawSections = Array.isArray(data.body_json) ? data.body_json : [];
  const sections: Section[] = rawSections
    .map((s: { heading?: string; body?: string }) => ({
      heading: s?.heading,
      body: (s?.body ?? "").trim(),
    }))
    .filter((s: Section) => s.body.length > 0);

  const paragraphs = sections.map((s) => s.body);

  // Flattened text used to ground the side chat. Headings are folded in so
  // the model can reason about the article's structure.
  const bodyText = sections
    .map((s) => (s.heading ? `## ${s.heading}\n${s.body}` : s.body))
    .join("\n\n")
    .trim();

  const categoryLabel = data.category ?? "Analysis";
  const tagTone: TagTone = FALLBACK_TAG_TONE[categoryLabel] ?? "neutral";

  return NextResponse.json({
    slug: data.slug,
    title: data.title,
    category: categoryLabel,
    summary: data.description ?? "",
    date: data.published_at ?? new Date().toISOString(),
    read_time: data.read_time ?? "4 min read",
    author: data.author ?? null,
    tag: categoryLabel,
    tag_tone: tagTone,
    pull_quote: data.pull_quote ?? null,
    drug_id: data.drug_id ?? null,
    drug_name: data.drug_name ?? null,
    sections,
    paragraphs,
    body_text: bodyText,
  });
}
