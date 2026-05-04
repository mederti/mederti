import { MetadataRoute } from "next";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

// Sitemap is regenerated on every request rather than baked into the build,
// so missing build-time env vars never break the deploy.
export const dynamic = "force-dynamic";
export const revalidate = 3600; // cache for 1h between requests

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Resilient: if env isn't configured at this moment, ship just the static
  // pages instead of throwing and breaking the build / 500ing the route.
  let drugPages: MetadataRoute.Sitemap = [];
  try {
    if (
      (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL) &&
      process.env.SUPABASE_SERVICE_ROLE_KEY
    ) {
      const supabase = getSupabaseAdmin();

      // Get drugs with shortage history (most SEO-valuable pages)
      const { data: drugs } = await supabase
        .from("drugs")
        .select("id, updated_at")
        .order("updated_at", { ascending: false })
        .limit(5000);

      drugPages = (drugs ?? []).map((drug) => ({
        url: `https://mederti.vercel.app/drugs/${drug.id}`,
        lastModified: new Date(drug.updated_at),
        changeFrequency: "daily" as const,
        priority: 0.8,
      }));
    }
  } catch (err) {
    // Don't fail the build — log and continue with static pages only.
    console.warn("sitemap: drug page generation skipped:", err);
  }

  const staticPages: MetadataRoute.Sitemap = [
    {
      url: "https://mederti.vercel.app",
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 1.0,
    },
    {
      url: "https://mederti.vercel.app/search",
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 0.9,
    },
    {
      url: "https://mederti.vercel.app/shortages",
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 0.9,
    },
    {
      url: "https://mederti.vercel.app/recalls",
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 0.8,
    },
    {
      url: "https://mederti.vercel.app/dashboard",
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 0.8,
    },
    {
      url: "https://mederti.vercel.app/about",
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.5,
    },
    {
      url: "https://mederti.vercel.app/chat",
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.7,
    },
  ];

  return [...staticPages, ...drugPages];
}
