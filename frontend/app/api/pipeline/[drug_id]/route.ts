import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * GET /api/pipeline/[drug_id]
 *
 * Returns regulatory events + Phase III/IV trials for a single drug.
 * Used by the Pipeline & Regulatory widget on drug pages.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ drug_id: string }> }) {
  const { drug_id: drugId } = await ctx.params;
  if (!drugId) return NextResponse.json({ events: [], trials: [] });

  const admin = getSupabaseAdmin();
  const today = new Date().toISOString().slice(0, 10);

  const [eventsRes, trialsRes] = await Promise.all([
    admin
      .from("regulatory_events")
      .select("id, event_type, event_date, sponsor, indication, description, outcome, source_url, source_country")
      .eq("drug_id", drugId)
      .order("event_date", { ascending: false })
      .limit(20),
    admin
      .from("clinical_trials")
      .select("id, nct_id, intervention_name, brief_title, sponsor, phase, overall_status, primary_completion_date, conditions, countries, source_url")
      .eq("drug_id", drugId)
      .in("phase", ["Phase 3", "Phase 4", "PHASE3", "PHASE4"])
      .order("primary_completion_date", { ascending: false, nullsFirst: false })
      .limit(15),
  ]);

  const events = eventsRes.data ?? [];
  const trials = trialsRes.data ?? [];

  // Split events into upcoming vs historical
  const upcoming = events.filter((e: { event_date: string | null }) => e.event_date && e.event_date >= today);
  const historical = events.filter((e: { event_date: string | null }) => !e.event_date || e.event_date < today);

  // Split trials into ongoing vs completed
  const ongoingTrials = trials.filter((t: { overall_status: string }) =>
    ["RECRUITING", "ACTIVE_NOT_RECRUITING"].includes(t.overall_status));
  const completedTrials = trials.filter((t: { overall_status: string }) =>
    ["COMPLETED", "TERMINATED", "UNKNOWN"].includes(t.overall_status));

  return NextResponse.json({
    upcoming_events: upcoming,
    historical_events: historical,
    ongoing_trials: ongoingTrials,
    completed_trials: completedTrials,
    counts: {
      upcoming_events: upcoming.length,
      historical_events: historical.length,
      ongoing_trials: ongoingTrials.length,
      completed_trials: completedTrials.length,
    },
  });
}
