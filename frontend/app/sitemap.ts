import { MetadataRoute } from "next";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { siteUrl } from "@/lib/seo";

// Sitemap is regenerated on every request rather than baked into the build,
// so missing build-time env vars never break the deploy.
export const dynamic = "force-dynamic";
export const revalidate = 3600; // cache for 1h between requests

const SOFT_LAUNCH =
  (process.env.NEXT_PUBLIC_SOFT_LAUNCH ?? "").toLowerCase() === "true";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();

  // Resilient: if env isn't configured at this moment, ship just the static
  // pages instead of throwing and breaking the build / 500ing the route.
  let drugPages: MetadataRoute.Sitemap = [];
  let intelligencePages: MetadataRoute.Sitemap = [];
  try {
    if (
      (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL) &&
      process.env.SUPABASE_SERVICE_ROLE_KEY
    ) {
      const supabase = getSupabaseAdmin();

      // Drug pages — by far the largest, most SEO-valuable surface
      const { data: drugs } = await supabase
        .from("drugs")
        .select("id, updated_at")
        .order("updated_at", { ascending: false })
        .limit(5000);

      drugPages = (drugs ?? []).map((drug) => ({
        url: `${base}/drugs/${drug.id}`,
        lastModified: new Date(drug.updated_at),
        changeFrequency: "daily" as const,
        priority: 0.8,
      }));

      // Published intelligence articles
      try {
        const { data: articles } = await supabase
          .from("intelligence_articles")
          .select("slug, published_at, updated_at")
          .eq("status", "published")
          .order("published_at", { ascending: false })
          .limit(500);
        intelligencePages = (articles ?? []).map((a) => ({
          url: `${base}/intelligence/${a.slug}`,
          lastModified: new Date(a.updated_at || a.published_at),
          changeFrequency: "weekly" as const,
          priority: 0.6,
        }));
      } catch {
        // intelligence_articles table may not exist on every env
      }
    }
  } catch (err) {
    console.warn("sitemap: drug page generation skipped:", err);
  }

  const allStatic: MetadataRoute.Sitemap = [
    { url: `${base}`,                changeFrequency: "daily",   priority: 1.0, lastModified: new Date() },
    { url: `${base}/search`,         changeFrequency: "daily",   priority: 0.9, lastModified: new Date() },
    { url: `${base}/intelligence`,   changeFrequency: "weekly",  priority: 0.8, lastModified: new Date() },
    { url: `${base}/signup`,         changeFrequency: "monthly", priority: 0.6, lastModified: new Date() },
    { url: `${base}/login`,          changeFrequency: "monthly", priority: 0.4, lastModified: new Date() },
    // The following are full-launch pages — omit them under soft-launch.
    ...(SOFT_LAUNCH ? [] : [
      { url: `${base}/shortages`,    changeFrequency: "daily"   as const, priority: 0.9, lastModified: new Date() },
      { url: `${base}/recalls`,      changeFrequency: "daily"   as const, priority: 0.8, lastModified: new Date() },
      { url: `${base}/dashboard`,    changeFrequency: "daily"   as const, priority: 0.8, lastModified: new Date() },
      { url: `${base}/about`,        changeFrequency: "monthly" as const, priority: 0.5, lastModified: new Date() },
      { url: `${base}/pricing`,      changeFrequency: "monthly" as const, priority: 0.5, lastModified: new Date() },
      { url: `${base}/contact`,      changeFrequency: "monthly" as const, priority: 0.4, lastModified: new Date() },
      { url: `${base}/chat`,         changeFrequency: "weekly"  as const, priority: 0.7, lastModified: new Date() },
      { url: `${base}/pharmacists`,  changeFrequency: "monthly" as const, priority: 0.6, lastModified: new Date() },
      { url: `${base}/doctors`,      changeFrequency: "monthly" as const, priority: 0.6, lastModified: new Date() },
      { url: `${base}/hospitals`,    changeFrequency: "monthly" as const, priority: 0.6, lastModified: new Date() },
      { url: `${base}/government`,   changeFrequency: "monthly" as const, priority: 0.6, lastModified: new Date() },
      { url: `${base}/suppliers`,    changeFrequency: "monthly" as const, priority: 0.6, lastModified: new Date() },
    ]),
  ];

  return [...allStatic, ...drugPages, ...intelligencePages];
}
