import { MetadataRoute } from "next";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { siteUrl } from "@/lib/seo";
import { slugify, regulatorSlug, isQualityDrugSlug } from "@/lib/pseo";
import { COUNTRY_NAMES, countrySlug } from "@/lib/geo/country-names";

// Sitemap is regenerated on every request rather than baked into the build,
// so missing build-time env vars never break the deploy.
export const dynamic = "force-dynamic";
export const revalidate = 3600; // cache for 1h between requests

const SOFT_LAUNCH =
  (process.env.NEXT_PUBLIC_SOFT_LAUNCH ?? "").toLowerCase() === "true";

// Only URLs a logged-out crawler gets a 200 for belong here. The old sitemap
// advertised ~1,000 /drugs/[uuid] URLs that 307'd to /login — worse than
// useless. The public data surface is now the /medicine, /country and
// /regulator programmatic layer.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();

  let medicinePages: MetadataRoute.Sitemap = [];
  let regulatorPages: MetadataRoute.Sitemap = [];
  try {
    if (
      (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL) &&
      process.env.SUPABASE_SERVICE_ROLE_KEY
    ) {
      const supabase = getSupabaseAdmin();

      // Medicines with at least one shortage event AND a strong external
      // identity (RxCUI or ATC) — the pages with real unique value. The
      // drugs table also holds product-level junk rows; those render but
      // are noindexed (see isIndexableDrug), so they don't belong here.
      // The !inner embed keeps only drugs that have events; the embed is
      // capped at one row since we only need existence. Paged because
      // PostgREST caps responses at 1000.
      const seen = new Set<string>();
      for (let page = 0; page < 12; page++) {
        const { data, error } = await supabase
          .from("drugs")
          .select("generic_name, updated_at, rxcui, atc_code, shortage_events!inner(drug_id)")
          .or("rxcui.not.is.null,atc_code.not.is.null")
          .order("updated_at", { ascending: false })
          .limit(1, { referencedTable: "shortage_events" })
          .range(page * 1000, page * 1000 + 999);
        if (error || !data || data.length === 0) break;
        for (const drug of data as Array<{ generic_name: string; updated_at: string }>) {
          const slug = slugify(drug.generic_name);
          if (!slug || seen.has(slug) || !isQualityDrugSlug(slug)) continue;
          seen.add(slug);
          medicinePages.push({
            url: `${base}/medicine/${slug}`,
            lastModified: new Date(drug.updated_at),
            changeFrequency: "daily",
            priority: 0.8,
          });
        }
        if (data.length < 1000) break;
      }

      // Regulator profiles from the live source catalogue.
      const { data: sources } = await supabase
        .from("data_sources")
        .select("abbreviation, country_code, is_active, last_scraped_at")
        .eq("is_active", true);
      regulatorPages = (sources ?? []).map((s) => ({
        url: `${base}/regulator/${regulatorSlug(s as { abbreviation: string; country_code: string })}`,
        lastModified: s.last_scraped_at ? new Date(s.last_scraped_at) : new Date(),
        changeFrequency: "weekly" as const,
        priority: 0.5,
      }));
    }
  } catch (err) {
    console.warn("sitemap: programmatic page generation skipped:", err);
  }

  // Country registers — static list, one page per tracked country.
  const countryPages: MetadataRoute.Sitemap = Object.keys(COUNTRY_NAMES).map(
    (code) => ({
      url: `${base}/country/${countrySlug(code)}/medicine-shortages`,
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 0.7,
    }),
  );

  const allStatic: MetadataRoute.Sitemap = [
    { url: `${base}`,            changeFrequency: "daily",   priority: 1.0, lastModified: new Date() },
    { url: `${base}/medicine`,   changeFrequency: "daily",   priority: 0.9, lastModified: new Date() },
    { url: `${base}/country`,    changeFrequency: "weekly",  priority: 0.8, lastModified: new Date() },
    { url: `${base}/regulator`,  changeFrequency: "weekly",  priority: 0.7, lastModified: new Date() },
    { url: `${base}/signup`,     changeFrequency: "monthly", priority: 0.6, lastModified: new Date() },
    { url: `${base}/about`,      changeFrequency: "monthly", priority: 0.5, lastModified: new Date() },
    { url: `${base}/privacy`,    changeFrequency: "monthly", priority: 0.3, lastModified: new Date() },
    { url: `${base}/terms`,      changeFrequency: "monthly", priority: 0.3, lastModified: new Date() },
    { url: `${base}/contact`,    changeFrequency: "monthly", priority: 0.4, lastModified: new Date() },
    // Pages the soft-launch gate 308s to /coming-soon — only list when open.
    ...(SOFT_LAUNCH ? [] : [
      { url: `${base}/pricing`,     changeFrequency: "monthly" as const, priority: 0.5, lastModified: new Date() },
      { url: `${base}/pharmacists`, changeFrequency: "monthly" as const, priority: 0.6, lastModified: new Date() },
      { url: `${base}/doctors`,     changeFrequency: "monthly" as const, priority: 0.6, lastModified: new Date() },
      { url: `${base}/hospitals`,   changeFrequency: "monthly" as const, priority: 0.6, lastModified: new Date() },
      { url: `${base}/government`,  changeFrequency: "monthly" as const, priority: 0.6, lastModified: new Date() },
      { url: `${base}/suppliers`,   changeFrequency: "monthly" as const, priority: 0.6, lastModified: new Date() },
    ]),
  ];

  return [...allStatic, ...countryPages, ...medicinePages, ...regulatorPages];
}
