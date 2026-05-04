"use client";

import { useEffect, useState } from "react";
import { Users, TrendingDown, Clock, Globe2, Compass, Building2 } from "lucide-react";
import SiteNav from "@/app/components/landing-nav";

// ─── Types ───────────────────────────────────────────────────────────────────

interface CohortPayload {
  generated_at: string;
  funnel: {
    signed_up: number;
    started_onboarding: number;
    completed_onboarding: number;
    completion_rate_pct: number;
  };
  step_dropoff: {
    bounced_step1: number;
    bounced_step2: number;
    bounced_step3: number;
    bounced_step4_or_5: number;
    completed: number;
  };
  median_completion_minutes: number | null;
  distributions: {
    role: Record<string, number>;
    use_case: Record<string, number>;
    org_size: Record<string, number>;
    country: Record<string, number>;
    therapy_area: Record<string, number>;
  };
  role_by_use_case: Record<string, Record<string, number>>;
  daily: {
    keys: string[];
    started: Record<string, number>;
    completed: Record<string, number>;
  };
}

// ─── Display labels (must mirror the migration enums) ────────────────────────

const ROLE_LABEL: Record<string, string> = {
  hospital_pharmacist:  "Hospital pharmacist",
  community_pharmacist: "Community pharmacist",
  hospital_procurement: "Hospital procurement",
  wholesaler:           "Wholesaler / distributor",
  manufacturer:         "Pharma manufacturer",
  government:           "Government / regulator",
  researcher:           "Researcher / journalist",
  pharmacist:           "Pharmacist (legacy)",
  hospital:             "Hospital (legacy)",
  supplier:             "Supplier (legacy)",
  default:              "Unspecified",
  other:                "Other",
};
const USE_CASE_LABEL: Record<string, string> = {
  find_alternative: "Find alternative",
  plan_ahead:       "Plan ahead",
  sell_or_source:   "Sell or source",
  analyse_market:   "Analyse market",
  just_exploring:   "Just exploring",
};
const ORG_SIZE_LABEL: Record<string, string> = {
  just_me:   "Just me",
  "2_10":    "2 – 10",
  "11_50":   "11 – 50",
  "51_250":  "51 – 250",
  "251_1000":"251 – 1k",
  "1000_plus":"1k+",
};
const THERAPY_LABEL: Record<string, string> = {
  oncology:                  "Oncology",
  cardiovascular_metabolic:  "CV / metabolic",
  anti_infectives:           "Anti-infectives",
  cns_mental_health:         "CNS / mental",
  respiratory:               "Respiratory",
  anaesthesia_critical_care: "Anaesthesia",
  endocrine_hormones:        "Endocrine",
  other:                     "Other",
};
const FLAG: Record<string, string> = {
  AU:"🇦🇺", GB:"🇬🇧", US:"🇺🇸", CA:"🇨🇦", DE:"🇩🇪", FR:"🇫🇷", IT:"🇮🇹", ES:"🇪🇸",
  NZ:"🇳🇿", IE:"🇮🇪", NL:"🇳🇱", BE:"🇧🇪", SG:"🇸🇬", JP:"🇯🇵", IN:"🇮🇳", AE:"🇦🇪",
};

// ─── Component ───────────────────────────────────────────────────────────────

export default function CohortsPage() {
  const [data, setData] = useState<CohortPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/cohorts")
      .then(async (r) => {
        if (r.status === 401) { setErr("Sign in to view this page."); return null; }
        if (r.status === 403) { setErr("Admin access required."); return null; }
        if (!r.ok) { setErr("Could not load cohort data."); return null; }
        return r.json();
      })
      .then((d) => d && setData(d))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div style={{ minHeight: "100vh", background: "var(--app-bg)", color: "var(--app-text)" }}>
      <SiteNav />

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "28px 24px 60px" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 18 }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, letterSpacing: "-0.01em" }}>Signups</h1>
            <p style={{ fontSize: 13, color: "var(--app-text-3)", margin: "2px 0 0" }}>
              Funnel, cohorts and drop-off across the onboarding flow.
            </p>
          </div>
          {data?.generated_at && (
            <span style={{ fontSize: 11, color: "var(--app-text-4)", fontFamily: "var(--font-dm-mono), monospace" }}>
              as of {new Date(data.generated_at).toLocaleString("en-GB")}
            </span>
          )}
        </div>

        {loading && <Loading />}
        {err && <ErrorBox msg={err} />}

        {data && (
          <>
            {/* ── Funnel ── */}
            <section style={{ marginBottom: 24 }}>
              <SectionTitle icon={Users} label="Funnel" />
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
                <Stat label="Signed up"            value={data.funnel.signed_up} />
                <Stat label="Started onboarding"
                      value={data.funnel.started_onboarding}
                      sub={pct(data.funnel.started_onboarding, data.funnel.signed_up)} />
                <Stat label="Completed"
                      value={data.funnel.completed_onboarding}
                      sub={pct(data.funnel.completed_onboarding, data.funnel.signed_up)}
                      colour="var(--teal)" />
                <Stat label="Median time to finish"
                      value={data.median_completion_minutes ?? "—"}
                      sub={data.median_completion_minutes ? "minutes" : null}
                      colour="var(--app-text-2)" />
              </div>
            </section>

            {/* ── Step drop-off ── */}
            <section style={{ marginBottom: 24 }}>
              <SectionTitle icon={TrendingDown} label="Where users stop" />
              <Card>
                <FunnelBar
                  segments={[
                    { label: "Step 1 — Role",            n: data.step_dropoff.bounced_step1, c: "#ef4444" },
                    { label: "Step 2 — Countries",       n: data.step_dropoff.bounced_step2, c: "#f97316" },
                    { label: "Step 3 — Use case",        n: data.step_dropoff.bounced_step3, c: "#eab308" },
                    { label: "Step 4–5 — Optional",      n: data.step_dropoff.bounced_step4_or_5, c: "#84cc16" },
                    { label: "Completed",                n: data.step_dropoff.completed, c: "var(--teal)" },
                  ]}
                />
              </Card>
            </section>

            {/* ── Daily signups (last 30 days) ── */}
            <section style={{ marginBottom: 24 }}>
              <SectionTitle icon={Clock} label="Last 30 days" />
              <Card>
                <DailyChart
                  keys={data.daily.keys}
                  started={data.daily.started}
                  completed={data.daily.completed}
                />
              </Card>
            </section>

            {/* ── Distributions ── */}
            <section style={{ marginBottom: 24 }}>
              <SectionTitle icon={Compass} label="Who, what, where" />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <DistribCard
                  title="Role"
                  data={data.distributions.role}
                  labelMap={ROLE_LABEL}
                />
                <DistribCard
                  title="Use case"
                  data={data.distributions.use_case}
                  labelMap={USE_CASE_LABEL}
                />
                <DistribCard
                  title="Country"
                  data={data.distributions.country}
                  labelMap={Object.fromEntries(
                    Object.keys(data.distributions.country).map((k) => [k, `${FLAG[k] ?? ""} ${k}`]),
                  )}
                />
                <DistribCard
                  title="Org size"
                  data={data.distributions.org_size}
                  labelMap={ORG_SIZE_LABEL}
                />
                <DistribCard
                  title="Therapy areas"
                  data={data.distributions.therapy_area}
                  labelMap={THERAPY_LABEL}
                  span2
                />
              </div>
            </section>

            {/* ── Role × use case ── */}
            <section style={{ marginBottom: 24 }}>
              <SectionTitle icon={Building2} label="Role × use case" />
              <Card>
                <Heatmap matrix={data.role_by_use_case} />
              </Card>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function SectionTitle({ icon: Icon, label }: { icon: React.ElementType; label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "0 0 10px" }}>
      <Icon size={14} color="var(--teal)" />
      <span style={{
        fontSize: 11, fontWeight: 700, letterSpacing: "0.12em",
        textTransform: "uppercase", color: "var(--teal)",
      }}>
        {label}
      </span>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      background: "#fff", border: "1px solid var(--app-border)",
      borderRadius: 12, padding: 16,
    }}>
      {children}
    </div>
  );
}

function Loading() {
  return <Card><div style={{ padding: "20px 0", color: "var(--app-text-4)", fontSize: 13 }}>Loading…</div></Card>;
}

function ErrorBox({ msg }: { msg: string }) {
  return (
    <div style={{
      background: "var(--crit-bg, #fef2f2)", border: "1px solid var(--crit-b, #fecaca)",
      borderRadius: 10, padding: "10px 14px", color: "var(--crit, #dc2626)", fontSize: 13,
    }}>{msg}</div>
  );
}

function Stat({
  label, value, sub, colour,
}: {
  label: string;
  value: number | string;
  sub?: string | null;
  colour?: string;
}) {
  return (
    <div style={{
      background: "#fff", border: "1px solid var(--app-border)", borderRadius: 12,
      padding: "14px 16px",
    }}>
      <div style={{ fontSize: 11, color: "var(--app-text-4)", letterSpacing: "0.04em", textTransform: "uppercase" }}>
        {label}
      </div>
      <div style={{
        fontSize: 26, fontWeight: 700,
        color: colour ?? "var(--app-text)",
        fontFamily: "var(--font-dm-mono), monospace",
        marginTop: 4,
      }}>
        {typeof value === "number" ? value.toLocaleString() : value}
      </div>
      {sub && (
        <div style={{ fontSize: 11, color: "var(--app-text-4)", marginTop: 2 }}>
          {sub}
        </div>
      )}
    </div>
  );
}

function pct(part: number, total: number): string | null {
  if (!total) return null;
  return `${Math.round((part / total) * 100)}% of signed up`;
}

function FunnelBar({
  segments,
}: {
  segments: Array<{ label: string; n: number; c: string }>;
}) {
  const total = segments.reduce((s, x) => s + x.n, 0) || 1;
  return (
    <div>
      <div style={{ display: "flex", height: 28, borderRadius: 8, overflow: "hidden", border: "1px solid var(--app-border)" }}>
        {segments.map((s) =>
          s.n === 0 ? null : (
            <div key={s.label} style={{
              flex: s.n / total,
              background: s.c,
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "#fff", fontSize: 11, fontWeight: 600, letterSpacing: "0.02em",
            }} title={`${s.label}: ${s.n}`}>
              {s.n / total > 0.06 ? s.n.toLocaleString() : ""}
            </div>
          )
        )}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginTop: 12 }}>
        {segments.map((s) => (
          <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--app-text-3)" }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: s.c, display: "inline-block" }} />
            <span>{s.label}</span>
            <span style={{ color: "var(--app-text-4)", fontFamily: "var(--font-dm-mono), monospace" }}>{s.n.toLocaleString()}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DailyChart({
  keys, started, completed,
}: {
  keys: string[];
  started: Record<string, number>;
  completed: Record<string, number>;
}) {
  const max = Math.max(1, ...keys.map((k) => Math.max(started[k] ?? 0, completed[k] ?? 0)));
  return (
    <div>
      <div style={{
        display: "grid",
        gridTemplateColumns: `repeat(${keys.length}, 1fr)`,
        alignItems: "end",
        gap: 2,
        height: 120,
      }}>
        {keys.map((k) => {
          const s = started[k] ?? 0;
          const c = completed[k] ?? 0;
          return (
            <div key={k} style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%", gap: 1 }}
                 title={`${k} — started ${s}, completed ${c}`}>
              <div style={{ width: "100%", height: `${(s / max) * 80}%`, background: "var(--app-text-4)", borderRadius: "2px 2px 0 0" }} />
              <div style={{ width: "100%", height: `${(c / max) * 80}%`, background: "var(--teal)", borderRadius: "2px 2px 0 0" }} />
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 10, color: "var(--app-text-4)", fontFamily: "var(--font-dm-mono), monospace" }}>
        <span>{keys[0]}</span>
        <span>{keys[Math.floor(keys.length / 2)]}</span>
        <span>{keys[keys.length - 1]}</span>
      </div>
      <div style={{ display: "flex", gap: 14, marginTop: 10, fontSize: 12, color: "var(--app-text-3)" }}>
        <Legend colour="var(--app-text-4)" label="Started" />
        <Legend colour="var(--teal)"        label="Completed" />
      </div>
    </div>
  );
}

function Legend({ colour, label }: { colour: string; label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{ width: 9, height: 9, borderRadius: 2, background: colour, display: "inline-block" }} />
      {label}
    </div>
  );
}

function DistribCard({
  title, data, labelMap, span2,
}: {
  title: string;
  data: Record<string, number>;
  labelMap: Record<string, string>;
  span2?: boolean;
}) {
  const sorted = Object.entries(data).sort((a, b) => b[1] - a[1]);
  const total = sorted.reduce((s, [, v]) => s + v, 0) || 1;
  return (
    <div style={{
      background: "#fff", border: "1px solid var(--app-border)",
      borderRadius: 12, padding: 16,
      gridColumn: span2 ? "1 / -1" : undefined,
    }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>{title}</div>
      {sorted.length === 0 ? (
        <div style={{ fontSize: 12, color: "var(--app-text-4)" }}>No data yet.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          {sorted.map(([k, v]) => (
            <div key={k} style={{ display: "grid", gridTemplateColumns: "150px 1fr 50px", alignItems: "center", gap: 10, fontSize: 12 }}>
              <span style={{ color: "var(--app-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {labelMap[k] ?? k}
              </span>
              <div style={{ background: "var(--app-bg-2)", height: 8, borderRadius: 4, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${(v / total) * 100}%`, background: "var(--teal)" }} />
              </div>
              <span style={{ textAlign: "right", color: "var(--app-text-4)", fontFamily: "var(--font-dm-mono), monospace" }}>
                {v}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Heatmap({ matrix }: { matrix: Record<string, Record<string, number>> }) {
  const roles = Object.keys(matrix);
  const useCases: string[] = Array.from(
    new Set(roles.flatMap((r) => Object.keys(matrix[r] ?? {})))
  );
  // Sort by row total desc
  roles.sort((a, b) => {
    const sa = Object.values(matrix[a] ?? {}).reduce((s, x) => s + x, 0);
    const sb = Object.values(matrix[b] ?? {}).reduce((s, x) => s + x, 0);
    return sb - sa;
  });
  const max = Math.max(
    1,
    ...roles.flatMap((r) => Object.values(matrix[r] ?? {}))
  );

  if (roles.length === 0) {
    return <div style={{ fontSize: 12, color: "var(--app-text-4)", padding: 12 }}>Not enough completed signups yet.</div>;
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12, fontFamily: "var(--font-inter), sans-serif" }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left", padding: "6px 8px", color: "var(--app-text-4)", fontWeight: 500, fontSize: 11 }}>Role</th>
            {useCases.map((u) => (
              <th key={u} style={{ padding: "6px 8px", color: "var(--app-text-4)", fontWeight: 500, fontSize: 11, textAlign: "center" }}>
                {USE_CASE_LABEL[u] ?? u}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {roles.map((r) => (
            <tr key={r}>
              <td style={{ padding: "5px 8px", whiteSpace: "nowrap", color: "var(--app-text)" }}>{ROLE_LABEL[r] ?? r}</td>
              {useCases.map((u) => {
                const v = matrix[r]?.[u] ?? 0;
                const intensity = v / max;
                const bg = v === 0 ? "transparent" : `rgba(13, 148, 136, ${0.1 + intensity * 0.7})`;
                return (
                  <td key={u} style={{ textAlign: "center", padding: "5px 8px", background: bg, color: intensity > 0.6 ? "#fff" : "var(--app-text)", fontFamily: "var(--font-dm-mono), monospace" }}>
                    {v || ""}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
