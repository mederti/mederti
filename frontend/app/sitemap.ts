import { MetadataRoute } from "next";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const supabase = getSupabaseAdmin();

  // Get drugs with shortage history (most SEO-valuable pages)
  const { data: drugs } = await supabase
    .from("drugs")
    .select("id, updated_at")
    .order("updated_at", { ascending: false })
    .limit(5000);

  const drugPages = (drugs ?? []).map((drug) => ({
    url: `https://mederti.vercel.app/drugs/${drug.id}`,
    lastModified: new Date(drug.updated_at),
    changeFrequency: "daily" as const,
    priority: 0.8,
  }));

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
