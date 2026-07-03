import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { countryCentroid } from "@/lib/geo/country-centroids";
import { regulatorHqLocation } from "@/lib/geo/regulator-hq-locations";

// MapView data aggregation. Deliberately stricter than /api/shortages:
// filters out synthetic (recall-derived) and upstream-signal rows, since
// this route drives a country-level choropleth where noise visibly
// overstates risk rather than just appearing as one row in a list.
export const revalidate = 60;

const HORIZON_DAYS: Record<string, number | null> = {
  today: null,
  "30": 30,
  "60": 60,
  "90": 90,
  "180": 180,
  "365": 365,
};

const VALID_LAYERS = new Set(["shortages", "manufacturing", "manufacturers", "regulators"]);

type ShortageRow = {
  country: string | null;
  country_code: string | null;
  world_region: string | null;
  status: string;
  severity: string | null;
};

type FacilityRow = {
  country: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  oai_count_5y: number | null;
  import_alert_active: boolean | null;
};

type ManufacturerRow = {
  name: string | null;
  country: string | null;
  country_code: string | null;
  // Present after migration 069 + the --manufacturers geocoding backfill.
  hq_city?: string | null;
  hq_latitude?: number | null;
  hq_longitude?: number | null;
};

type RegulatorRow = {
  id: string;
  name: string;
  abbreviation: string | null;
  country: string | null;
  country_code: string | null;
  region: string | null;
};

const SEV_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };

function worstSeverity(a: string | null, b: string | null): string | null {
  const ra = a ? SEV_RANK[a] ?? 0 : 0;
  const rb = b ? SEV_RANK[b] ?? 0 : 0;
  return ra >= rb ? a : b;
}

// PostgREST caps a single response at ~1000 rows. Active shortages across 51
// countries (single molecules carry 17–27 events each) and the manufacturer/
// facility layers all exceed that, so an un-paginated query silently returns
// an arbitrary 1000-row sample — wrong per-country counts that shift between
// deploys. Drain in .range() pages, matching the shortage-trends fallback.
const PAGE = 1000;
const MAX_PAGES = 60; // 60k-row safety cap, well above any of these tables
async function drainQuery<T>(
  build: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
): Promise<{ data: T[]; error: { message: string } | null }> {
  const out: T[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await build(page * PAGE, page * PAGE + PAGE - 1);
    if (error) return { data: out, error }; // surface error (partial data kept)
    if (!data || data.length === 0) break;
    out.push(...(data as T[]));
    if (data.length < PAGE) break;
  }
  return { data: out, error: null };
}

export async function GET(req: NextRequest) {
  const limited = await enforceRateLimit(req, "browse");
  if (limited) return limited;

  const url = new URL(req.url);
  const horizonParam = url.searchParams.get("horizon") ?? "today";
  const layersParam = url.searchParams.get("layers");
  const layers = layersParam
    ? layersParam.split(",").map((l) => l.trim()).filter(Boolean)
    : ["shortages", "manufacturing", "manufacturers", "regulators"];

  if (!(horizonParam in HORIZON_DAYS)) {
    return NextResponse.json(
      { error: `horizon must be one of: ${Object.keys(HORIZON_DAYS).join(", ")}` },
      { status: 400 },
    );
  }
  const invalidLayer = layers.find((l) => !VALID_LAYERS.has(l));
  if (invalidLayer) {
    return NextResponse.json(
      { error: `unknown layer "${invalidLayer}" — valid layers: ${[...VALID_LAYERS].join(", ")}` },
      { status: 400 },
    );
  }

  // Untyped client: shortage_events/data_sources columns used here (world_region,
  // is_upstream_signal, anticipated_start_date, region) aren't modeled in the
  // hand-maintained Database type, and manufacturers/manufacturing_facilities
  // aren't modeled at all — see frontend/lib/supabase/admin.ts's doc comment.
  const sb = getSupabaseAdmin();
  const horizonDays = HORIZON_DAYS[horizonParam];

  const response: Record<string, unknown> = { horizon: horizonParam, layers };

  if (layers.includes("shortages")) {
    // This project has known migration drift (manual SQL-editor apply, easy
    // to miss a step) — world_region/is_upstream_signal (mig 010) or
    // anticipated_start_date (mig 049) may not exist in every environment
    // yet. Try the full-featured query first, and if Postgres reports a
    // missing column, degrade to the guaranteed-present mig-001 columns
    // rather than 500ing the whole map. Matches the fail-open pattern
    // already used in proxy.ts's onboarding check and the s19a notes fallback.
    let data: ShortageRow[] | null = null;
    let error: { message: string } | null = null;
    let degraded = false;

    const cutoff = new Date();
    if (horizonDays !== null) cutoff.setDate(cutoff.getDate() + horizonDays);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    {
      const res = await drainQuery<ShortageRow>((from, to) => {
        let query = sb
          .from("shortage_events")
          .select("country, country_code, world_region, status, severity")
          .eq("synthetic", false)
          .eq("is_upstream_signal", false);
        query = horizonDays === null
          ? query.eq("status", "active")
          : query.eq("status", "anticipated").lte("anticipated_start_date", cutoffStr);
        return query.range(from, to);
      });
      data = res.data;
      error = res.error;
    }

    if (error && /column .* does not exist/i.test(error.message)) {
      degraded = true;
      const res = await drainQuery<ShortageRow>((from, to) => {
        let query = sb.from("shortage_events").select("country, country_code, status, severity");
        query = horizonDays === null
          ? query.eq("status", "active")
          : query.eq("status", "anticipated").lte("estimated_resolution_date", cutoffStr);
        return query.range(from, to);
      });
      data = res.data;
      error = res.error;
    }

    if (error) {
      console.error("[/api/map-data] shortages query error:", error.message);
      return NextResponse.json({ error: "shortages query failed" }, { status: 500 });
    }
    if (degraded) {
      response.shortages_degraded =
        "world_region/is_upstream_signal/anticipated_start_date unavailable in this environment (migration drift) — showing reduced fields";
    }

    const byCountry = new Map<
      string,
      { country: string; country_code: string; world_region: string | null; count: number; severity: string | null }
    >();
    for (const row of (data ?? []) as ShortageRow[]) {
      if (!row.country_code) continue;
      const key = row.country_code.toUpperCase();
      const existing = byCountry.get(key);
      if (existing) {
        existing.count += 1;
        existing.severity = worstSeverity(existing.severity, row.severity);
      } else {
        byCountry.set(key, {
          country: row.country ?? key,
          country_code: key,
          world_region: row.world_region,
          count: 1,
          severity: row.severity,
        });
      }
    }

    response.shortages = Array.from(byCountry.values()).map((c) => ({
      ...c,
      centroid: countryCentroid(c.country_code),
    }));
  }

  if (layers.includes("manufacturing")) {
    const { data, error } = await drainQuery<FacilityRow>((from, to) =>
      sb
        .from("manufacturing_facilities")
        .select("country, city, latitude, longitude, oai_count_5y, import_alert_active")
        .not("latitude", "is", null)
        .not("longitude", "is", null)
        .range(from, to),
    );

    if (error) {
      // Migration 063 (latitude/longitude columns) or the geocoding backfill
      // may not have run yet in this environment — degrade to an empty
      // layer instead of failing the whole map.
      if (/column .* does not exist/i.test(error.message)) {
        console.warn("[/api/map-data] manufacturing_facilities.latitude/longitude not present yet:", error.message);
        response.manufacturing = [];
        response.manufacturing_degraded = "coordinates not available yet in this environment (migration 063 / geocoding backfill pending)";
      } else {
        console.error("[/api/map-data] manufacturing query error:", error.message);
        return NextResponse.json({ error: "manufacturing query failed" }, { status: 500 });
      }
    } else {
      // Cluster by (country, city, rounded lat/lng) so many facilities sharing
      // a city render as one sized marker instead of thousands of overlapping dots.
      const clusters = new Map<
        string,
        { country: string; city: string | null; lat: number; lng: number; count: number; max_oai: number; any_import_alert: boolean }
      >();
      for (const row of (data ?? []) as FacilityRow[]) {
        if (row.latitude == null || row.longitude == null) continue;
        const lat = Math.round(row.latitude * 10) / 10;
        const lng = Math.round(row.longitude * 10) / 10;
        const key = `${lat},${lng}`;
        const existing = clusters.get(key);
        if (existing) {
          existing.count += 1;
          existing.max_oai = Math.max(existing.max_oai, row.oai_count_5y ?? 0);
          existing.any_import_alert = existing.any_import_alert || !!row.import_alert_active;
        } else {
          clusters.set(key, {
            country: row.country ?? "",
            city: row.city,
            lat,
            lng,
            count: 1,
            max_oai: row.oai_count_5y ?? 0,
            any_import_alert: !!row.import_alert_active,
          });
        }
      }

      response.manufacturing = Array.from(clusters.values());
    }
  }

  if (layers.includes("manufacturers")) {
    // hq_* columns arrive with migration 069 — fall back to the pre-069
    // selection if they aren't applied in this environment yet.
    const primary = await drainQuery<ManufacturerRow>((from, to) =>
      sb
        .from("manufacturers")
        .select("name, country, country_code, hq_city, hq_latitude, hq_longitude")
        .eq("is_active", true)
        .range(from, to),
    );
    let data: unknown[] | null = primary.data;
    let error = primary.error;
    let hqAvailable = true;
    if (error && /column .* does not exist/i.test(error.message)) {
      hqAvailable = false;
      const fallback = await drainQuery<ManufacturerRow>((from, to) =>
        sb.from("manufacturers").select("name, country, country_code").eq("is_active", true).range(from, to),
      );
      data = fallback.data;
      error = fallback.error;
    }
    if (error) {
      console.error("[/api/map-data] manufacturers query error:", error.message);
      return NextResponse.json({ error: "manufacturers query failed" }, { status: 500 });
    }
    if (!hqAvailable) {
      response.manufacturers_degraded =
        "manufacturer HQ coordinates unavailable in this environment (migration 069 / geocoding backfill pending) — showing country-level markers";
    }

    const rows = (data ?? []) as ManufacturerRow[];
    // Rows with geocoded HQs get their own city-level marker; the rest are
    // grouped into one honest country-level marker per country.
    const cityMarkers = rows
      .filter((r) => r.hq_latitude != null && r.hq_longitude != null)
      .map((r) => ({
        name: r.name,
        country: r.country ?? r.country_code ?? "",
        country_code: (r.country_code ?? "").toUpperCase(),
        count: 1,
        city: r.hq_city,
        centroid: { lat: r.hq_latitude as number, lng: r.hq_longitude as number },
        granularity: "city" as const,
      }));

    const byCountry = new Map<string, { country: string; country_code: string; count: number }>();
    for (const row of rows) {
      if (!row.country_code || (row.hq_latitude != null && row.hq_longitude != null)) continue;
      const key = row.country_code.toUpperCase();
      const existing = byCountry.get(key);
      if (existing) existing.count += 1;
      else byCountry.set(key, { country: row.country ?? key, country_code: key, count: 1 });
    }
    const countryMarkers = Array.from(byCountry.values()).map((m) => ({
      ...m,
      centroid: countryCentroid(m.country_code),
      granularity: "country" as const,
    }));

    response.manufacturers = [...cityMarkers, ...countryMarkers];
  }

  if (layers.includes("regulators")) {
    const { data, error } = await sb
      .from("data_sources")
      .select("id, name, abbreviation, country, country_code, region")
      .eq("is_active", true);
    if (error) {
      console.error("[/api/map-data] regulators query error:", error.message);
      return NextResponse.json({ error: "regulators query failed" }, { status: 500 });
    }

    response.regulators = ((data ?? []) as RegulatorRow[])
      .filter((r) => !!r.country_code)
      .map((r) => {
        // Regulator HQ cities are stable public knowledge — resolved from a
        // hand-curated table (abbreviation override -> national agency city),
        // falling back to the country centroid only when unknown.
        const hq = regulatorHqLocation(r.abbreviation, r.country_code);
        return {
          id: r.id,
          name: r.name,
          abbreviation: r.abbreviation,
          country: r.country,
          country_code: (r.country_code as string).toUpperCase(),
          region: r.region,
          city: hq?.city ?? null,
          centroid: hq ? { lat: hq.lat, lng: hq.lng } : countryCentroid(r.country_code),
          granularity: hq ? ("city" as const) : ("country" as const),
        };
      });
  }

  return NextResponse.json(response);
}
