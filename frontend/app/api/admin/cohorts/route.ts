import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/cohorts
 *
 * Cohort + funnel analytics off user_profiles. Returns the data the
 * /admin/cohorts dashboard renders:
 *
 *   • Funnel: signed up → started onboarding → completed onboarding
 *   • Drop-off by step (which step are unfinished users stuck at?)
 *   • Role / use_case / org_size / country / therapy_area distributions
 *   • Role × use_case matrix
 *   • Daily signups over the last 30 days
 *
 * Aggregations run server-side; the client just renders.
 */

type Counts = Record<string, number>;
type Matrix = Record<string, Counts>; // role -> use_case -> count

interface Profile {
  role: string | null;
  countries: string[] | null;
  use_case: string | null;
  org_size: string | null;
  therapy_areas: string[] | null;
  onboarding_done: boolean | null;
  onboarding_done_at: string | null;
  created_at: string | null;
}

async function isAdmin(): Promise<boolean> {
  // Minimal admin gate: signed-in users only. Tighten with a proper allow-list
  // (e.g. user_profiles.role = 'admin' or env ADMIN_EMAILS) once we have one.
  try {
    const sb = await createServerClient();
    const { data: { user } } = await sb.auth.getUser();
    return Boolean(user?.id);
  } catch {
    return false;
  }
}

export async function GET() {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const admin = getSupabaseAdmin();

  // ── 1. Pull every profile row. We page through if needed.
  const profiles: Profile[] = [];
  let page = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await admin
      .from("user_profiles")
      .select(
        "role, countries, use_case, org_size, therapy_areas, onboarding_done, onboarding_done_at, created_at",
      )
      .range(page * pageSize, page * pageSize + pageSize - 1);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    profiles.push(...((data ?? []) as Profile[]));
    if (!data || data.length < pageSize) break;
    page++;
    if (page > 50) break; // safety
  }

  // ── 2. Total signups via auth admin API
  let totalSignedUp = profiles.length; // fallback
  try {
    let userCount = 0;
    let p = 1;
    while (true) {
      const { data, error } = await admin.auth.admin.listUsers({
        page: p,
        perPage: 1000,
      });
      if (error) break;
      userCount += data.users.length;
      if (data.users.length < 1000) break;
      p++;
      if (p > 20) break;
    }
    if (userCount > 0) totalSignedUp = userCount;
  } catch {
    /* fall through with profiles.length */
  }

  // ── 3. Funnel
  const startedOnboarding = profiles.length;
  const completedOnboarding = profiles.filter((p) => p.onboarding_done).length;

  // ── 4. Drop-off: where did unfinished users stop?
  // We infer the "last step the user reached" from which fields are populated.
  //   No row                       — never started
  //   role missing/default         — bounced on step 1
  //   role set, no country         — bounced on step 2
  //   countries set, no use_case   — bounced on step 3
  //   use_case set, not done       — paused on optional steps 4–5
  //   onboarding_done = true       — finished
  const stepDropoff = {
    bounced_step1: 0, // role unknown / 'default'
    bounced_step2: 0, // countries empty
    bounced_step3: 0, // use_case null
    bounced_step4_or_5: 0, // partial — got to optional but didn't complete
    completed: 0,
  };

  for (const p of profiles) {
    if (p.onboarding_done) {
      stepDropoff.completed++;
      continue;
    }
    const hasRole = !!p.role && p.role !== "default";
    const hasCountry = (p.countries?.length ?? 0) > 0;
    const hasUseCase = !!p.use_case;
    if (!hasRole) stepDropoff.bounced_step1++;
    else if (!hasCountry) stepDropoff.bounced_step2++;
    else if (!hasUseCase) stepDropoff.bounced_step3++;
    else stepDropoff.bounced_step4_or_5++;
  }

  // ── 5. Distributions (only completed users — those answers are clean)
  const completed = profiles.filter((p) => p.onboarding_done);
  const distrib = {
    role: {} as Counts,
    use_case: {} as Counts,
    org_size: {} as Counts,
    country: {} as Counts,
    therapy_area: {} as Counts,
  };
  for (const p of completed) {
    if (p.role) distrib.role[p.role] = (distrib.role[p.role] ?? 0) + 1;
    if (p.use_case) distrib.use_case[p.use_case] = (distrib.use_case[p.use_case] ?? 0) + 1;
    if (p.org_size) distrib.org_size[p.org_size] = (distrib.org_size[p.org_size] ?? 0) + 1;
    for (const c of p.countries ?? []) {
      distrib.country[c] = (distrib.country[c] ?? 0) + 1;
    }
    for (const t of p.therapy_areas ?? []) {
      distrib.therapy_area[t] = (distrib.therapy_area[t] ?? 0) + 1;
    }
  }

  // ── 6. Role × use_case matrix
  const matrix: Matrix = {};
  for (const p of completed) {
    if (!p.role || !p.use_case) continue;
    matrix[p.role] = matrix[p.role] ?? {};
    matrix[p.role][p.use_case] = (matrix[p.role][p.use_case] ?? 0) + 1;
  }

  // ── 7. Daily signups (last 30 days) — both started and completed
  const dayKeys: string[] = [];
  const dailyStarted: Counts = {};
  const dailyCompleted: Counts = {};
  const today = new Date();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    dayKeys.push(key);
    dailyStarted[key] = 0;
    dailyCompleted[key] = 0;
  }
  for (const p of profiles) {
    if (p.created_at) {
      const k = p.created_at.slice(0, 10);
      if (k in dailyStarted) dailyStarted[k]++;
    }
    if (p.onboarding_done_at) {
      const k = p.onboarding_done_at.slice(0, 10);
      if (k in dailyCompleted) dailyCompleted[k]++;
    }
  }

  // ── 8. Median time-to-complete (in minutes)
  const completionMinutes: number[] = [];
  for (const p of completed) {
    if (!p.created_at || !p.onboarding_done_at) continue;
    const ms = +new Date(p.onboarding_done_at) - +new Date(p.created_at);
    if (ms > 0) completionMinutes.push(Math.round(ms / 60000));
  }
  completionMinutes.sort((a, b) => a - b);
  const median =
    completionMinutes.length === 0
      ? null
      : completionMinutes[Math.floor(completionMinutes.length / 2)];

  return NextResponse.json({
    generated_at: new Date().toISOString(),
    funnel: {
      signed_up: totalSignedUp,
      started_onboarding: startedOnboarding,
      completed_onboarding: completedOnboarding,
      completion_rate_pct:
        totalSignedUp > 0 ? Math.round((completedOnboarding / totalSignedUp) * 100) : 0,
    },
    step_dropoff: stepDropoff,
    median_completion_minutes: median,
    distributions: distrib,
    role_by_use_case: matrix,
    daily: {
      keys: dayKeys,
      started: dailyStarted,
      completed: dailyCompleted,
    },
  });
}
