"use client";

import { useEffect, useMemo, useState } from "react";
import { countryName } from "@/lib/geo/country-names";

/**
 * ShortageEpisodeTimeline — where and when this molecule has been short.
 *
 * One row per market, one bar per regulator shortage notice (start → end, or
 * → today if still open). Overlapping notices in a market stack into lanes.
 * Dose-form chips filter the rows ("is it the liquid that's short, or
 * everything?"); hovering or tapping a bar shows the product, dates and a link
 * to the regulator notice.
 *
 * Reads /api/drugs/[id]/shortage-episodes.
 */

type Form = "tablet" | "capsule" | "oral_liquid" | "injection" | "topical" | "inhaled" | "other";
interface Episode {
  country: string;
  status: string;
  start: string;
  end: string | null;
  expected_end: string | null;
  form: Form;
  product: string | null;
  source_url: string | null;
}

const FORM_LABEL: Record<Form, string> = {
  tablet: "Tablet",
  capsule: "Capsule",
  oral_liquid: "Oral liquid / powder",
  injection: "Injection",
  topical: "Topical",
  inhaled: "Inhaled",
  other: "Form not stated",
};
const FORM_ORDER: Form[] = ["tablet", "capsule", "oral_liquid", "injection", "inhaled", "topical", "other"];
const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY = 86400000;
const ROWS_COLLAPSED = 10;
const MAX_LANES = 4;

const ms = (d: string) => Date.parse(`${d}T00:00:00Z`);
const flag = (cc: string) =>
  /^[A-Z]{2}$/.test(cc) ? String.fromCodePoint(...[...cc].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)) : "🌐";
const fmtDate = (d: string) => {
  const t = new Date(ms(d));
  return `${t.getUTCDate()} ${MONTH_ABBR[t.getUTCMonth()]} ${t.getUTCFullYear()}`;
};
function duration(days: number): string {
  if (days < 14) return `${Math.max(days, 1)} day${days === 1 ? "" : "s"}`;
  if (days < 60) return `${Math.round(days / 7)} weeks`;
  const m = Math.round(days / 30.44);
  return m < 24 ? `${m} months` : `${(days / 365.25).toFixed(1)} years`;
}

export function ShortageEpisodeTimeline({ drugId }: { drugId: string }) {
  const [episodes, setEpisodes] = useState<Episode[] | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [form, setForm] = useState<Form | "all">("all");
  const [expanded, setExpanded] = useState(false);
  const [picked, setPicked] = useState<Episode | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/drugs/${encodeURIComponent(drugId)}/shortage-episodes`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { degraded?: boolean; episodes?: Episode[] } | null) => {
        if (cancelled) return;
        if (d && !d.degraded && Array.isArray(d.episodes)) {
          setEpisodes(d.episodes);
          setState("ready");
        } else {
          setState("error");
        }
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [drugId]);

  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const formCounts = useMemo(() => {
    const c = new Map<Form, number>();
    for (const e of episodes ?? []) c.set(e.form, (c.get(e.form) ?? 0) + 1);
    return FORM_ORDER.filter((f) => c.has(f)).map((f) => ({ form: f, n: c.get(f)! }));
  }, [episodes]);

  const view = useMemo(() => {
    if (!episodes || episodes.length === 0) return null;
    const list = form === "all" ? episodes : episodes.filter((e) => e.form === form);
    if (list.length === 0) return null;

    const isOpen = (e: Episode) => !e.end || e.end > today;
    const endOf = (e: Episode) => (isOpen(e) ? today : e.end!);

    // Axis: earliest start (at least 12 months back) → 3 months ahead, so
    // open bars visibly run up to "now" with room for anticipated onsets.
    const t0Raw = Math.min(...list.map((e) => ms(e.start)), ms(today) - 365 * DAY);
    const t0d = new Date(t0Raw);
    const t0 = Date.UTC(t0d.getUTCFullYear(), t0d.getUTCMonth(), 1);
    const t1 = Math.max(ms(today) + 90 * DAY, ...list.map((e) => ms(e.start) + 30 * DAY));
    const pct = (t: number) => ((t - t0) / (t1 - t0)) * 100;

    // Group by market; order: markets short right now first, then most recent.
    const byCountry = new Map<string, Episode[]>();
    for (const e of list) {
      const arr = byCountry.get(e.country) ?? [];
      arr.push(e);
      byCountry.set(e.country, arr);
    }
    const rows = [...byCountry.entries()]
      .map(([cc, eps]) => {
        eps.sort((a, b) => a.start.localeCompare(b.start));
        // Greedy lane packing so overlapping notices don't hide each other.
        const laneEnd: number[] = [];
        const bars = eps.map((e) => {
          const s = ms(e.start);
          const anticipated = e.status === "anticipated";
          const en = anticipated ? Math.max(ms(e.expected_end ?? e.start), s + 30 * DAY) : ms(endOf(e));
          let lane = laneEnd.findIndex((le) => le < s);
          if (lane === -1) lane = laneEnd.length < MAX_LANES ? laneEnd.length : MAX_LANES - 1;
          laneEnd[lane] = Math.max(laneEnd[lane] ?? 0, en);
          const open = !anticipated && isOpen(e);
          const exp = open && e.expected_end && e.expected_end > today ? ms(e.expected_end) : null;
          return {
            e,
            lane,
            left: pct(s),
            width: Math.max(pct(en) - pct(s), 0.6),
            kind: anticipated ? "ant" : open ? "open" : "done",
            expLeft: exp ? pct(ms(today)) : null,
            expWidth: exp ? pct(Math.min(exp, t1)) - pct(ms(today)) : null,
          };
        });
        const openNow = eps.some((e) => e.status !== "anticipated" && isOpen(e));
        const latest = eps[eps.length - 1].start;
        return { cc, bars, lanes: Math.max(laneEnd.length, 1), openNow, latest, n: eps.length };
      })
      .sort((a, b) => Number(b.openNow) - Number(a.openNow) || b.latest.localeCompare(a.latest));

    // Year ticks (quarters when the span is short).
    const ticks: { x: number; label: string }[] = [];
    const spanYears = (t1 - t0) / (365.25 * DAY);
    const stepM = spanYears > 10 ? 48 : spanYears > 6 ? 24 : spanYears > 2.5 ? 12 : 3;
    const d = new Date(t0);
    const k0 = d.getUTCFullYear() * 12 + d.getUTCMonth();
    for (let k = Math.ceil(k0 / stepM) * stepM; ; k += stepM) {
      const yr = Math.floor(k / 12);
      const mo = k % 12;
      const t = Date.UTC(yr, mo, 1);
      if (t > t1) break;
      ticks.push({ x: pct(t), label: mo === 0 ? String(yr) : `${MONTH_ABBR[mo]} '${String(yr).slice(2)}` });
    }

    const marketsOpen = rows.filter((r) => r.openNow).length;
    return { rows, ticks, nowX: pct(ms(today)), marketsOpen, total: list.length };
  }, [episodes, form, today]);

  if (state === "loading") return <div className="set-skel" aria-busy="true" aria-label="Loading shortage timeline" />;
  if (state === "error" || !episodes || episodes.length === 0) return null;

  const shown = view ? (expanded ? view.rows : view.rows.slice(0, ROWS_COLLAPSED)) : [];

  return (
    <div className="set">
      <style>{`
        .set{--open:#e0613a;--done:#c3cad2;--fut:#6366f1;--ink:#0c1118;--mute:#6a7280;--faint:#98a1ac;--grid:#eef2f5}
        .set .set-sum{font-size:12.5px;color:var(--mute);margin-bottom:10px}
        .set .set-sum b{color:var(--ink);font-weight:600}
        .set .set-chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px}
        .set .set-chip{appearance:none;border:1px solid #e3e7eb;background:#fff;border-radius:999px;padding:3px 10px;
          font-size:11.5px;color:var(--mute);cursor:pointer}
        .set .set-chip:hover{color:var(--ink);border-color:#c9d0d7}
        .set .set-chip[aria-pressed="true"]{background:var(--ink);border-color:var(--ink);color:#fff}
        .set .set-chip span{opacity:.6;margin-left:4px;font-variant-numeric:tabular-nums}
        .set .set-grid{display:grid;grid-template-columns:minmax(88px,140px) 1fr;column-gap:10px}
        .set .set-lab{font-size:12px;color:var(--ink);display:flex;align-items:center;gap:6px;min-width:0;padding:3px 0}
        .set .set-lab .nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .set .set-lab .ct{color:var(--faint);font-size:10.5px;font-variant-numeric:tabular-nums}
        .set .set-track{position:relative;border-bottom:1px solid var(--grid)}
        .set .set-bar{position:absolute;height:7px;border-radius:4px;cursor:pointer;border:0;padding:0}
        .set .set-bar.open{background:var(--open)}
        .set .set-bar.done{background:var(--done)}
        .set .set-bar.ant{background:rgba(99,102,241,.12);border:1.25px dashed var(--fut)}
        .set .set-bar:hover,.set .set-bar.sel{outline:2px solid var(--ink);outline-offset:1px}
        .set .set-exp{position:absolute;height:0;border-top:2px dotted var(--open);opacity:.6;pointer-events:none}
        .set .set-now{position:absolute;top:0;bottom:0;border-left:1px dashed var(--fut);opacity:.6;pointer-events:none}
        .set .set-tick{position:absolute;top:0;bottom:0;border-left:1px solid var(--grid);pointer-events:none}
        .set .set-axis{position:relative;height:18px;font-size:9.5px;color:var(--faint);font-family:var(--font-geist-mono),ui-monospace,monospace}
        .set .set-axis span{position:absolute;transform:translateX(-50%);top:4px;white-space:nowrap}
        .set .set-axis .now{color:var(--fut);font-weight:700;text-transform:uppercase;letter-spacing:.06em}
        .set .set-more{appearance:none;border:0;background:none;color:var(--mute);font-size:12px;cursor:pointer;padding:8px 0 0;text-decoration:underline}
        .set .set-legend{display:flex;flex-wrap:wrap;gap:14px;font-size:11px;color:var(--mute);margin-top:10px}
        .set .set-legend i{display:inline-block;width:14px;height:7px;border-radius:4px;margin-right:6px;vertical-align:middle}
        .set .set-detail{margin-top:10px;padding:10px 12px;border-radius:8px;background:#f6f8fa;font-size:12px;color:var(--ink);line-height:1.55;min-height:20px}
        .set .set-detail .k{color:var(--mute)}
        .set .set-detail a{color:var(--ink)}
        .set-skel{height:160px;border-radius:8px;background:linear-gradient(90deg,#eef2f5 25%,#f6f8fa 50%,#eef2f5 75%);background-size:200% 100%;animation:setsk 1.3s ease-in-out infinite}
        @keyframes setsk{0%{background-position:200% 0}100%{background-position:-200% 0}}
      `}</style>

      {formCounts.length > 1 && (
        <div className="set-chips" role="group" aria-label="Filter by dose form">
          <button type="button" className="set-chip" aria-pressed={form === "all"} onClick={() => { setForm("all"); setPicked(null); }}>
            All forms<span>{episodes.length}</span>
          </button>
          {formCounts.map(({ form: f, n }) => (
            <button key={f} type="button" className="set-chip" aria-pressed={form === f} onClick={() => { setForm(f); setPicked(null); }}>
              {FORM_LABEL[f]}<span>{n}</span>
            </button>
          ))}
        </div>
      )}

      {view && (
        <>
          <div className="set-sum">
            <b>{view.marketsOpen}</b> of {view.rows.length} market{view.rows.length === 1 ? "" : "s"} with a shortage open now
            {form !== "all" && <> · {FORM_LABEL[form].toLowerCase()} only</>} · {view.total} regulator notice{view.total === 1 ? "" : "s"}
          </div>

          <div className="set-grid">
            {shown.map((r) => (
              <div key={r.cc} style={{ display: "contents" }}>
                <div className="set-lab">
                  <span aria-hidden>{flag(r.cc)}</span>
                  <span className="nm">{countryName(r.cc)}</span>
                  {r.n > 1 && <span className="ct">×{r.n}</span>}
                </div>
                <div className="set-track" style={{ height: 8 + r.lanes * 11 }}>
                  {view.ticks.map((t) => (
                    <div key={t.x} className="set-tick" style={{ left: `${t.x}%` }} />
                  ))}
                  <div className="set-now" style={{ left: `${view.nowX}%` }} />
                  {r.bars.map((b, i) => (
                    <div key={i}>
                      {b.expLeft != null && b.expWidth != null && b.expWidth > 0 && (
                        <div className="set-exp" style={{ left: `${b.expLeft}%`, width: `${b.expWidth}%`, top: 7 + b.lane * 11 }} />
                      )}
                      <button
                        type="button"
                        className={`set-bar ${b.kind}${picked === b.e ? " sel" : ""}`}
                        style={{ left: `${b.left}%`, width: `${b.width}%`, top: 4 + b.lane * 11 }}
                        aria-label={`${countryName(r.cc)}: ${b.e.product ?? "shortage"} from ${fmtDate(b.e.start)}`}
                        onMouseEnter={() => setPicked(b.e)}
                        onFocus={() => setPicked(b.e)}
                        onClick={() => setPicked(b.e)}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}
            <div />
            <div className="set-axis">
              {/* Skip a tick label that would collide with "Now". */}
              {view.ticks.filter((t) => Math.abs(t.x - view.nowX) > 8).map((t) => (
                <span key={t.x} style={{ left: `${t.x}%` }}>{t.label}</span>
              ))}
              <span className="now" style={{ left: `${view.nowX}%` }}>Now</span>
            </div>
          </div>

          {view.rows.length > ROWS_COLLAPSED && (
            <button type="button" className="set-more" onClick={() => setExpanded((x) => !x)}>
              {expanded ? "Show fewer markets" : `Show all ${view.rows.length} markets`}
            </button>
          )}

          <div className="set-legend">
            <span><i style={{ background: "var(--open)" }} />Open now</span>
            <span><i style={{ background: "var(--done)" }} />Resolved</span>
            <span><i style={{ background: "rgba(99,102,241,.12)", border: "1.25px dashed var(--fut)" }} />Anticipated</span>
            <span><i style={{ height: 0, borderTop: "2px dotted var(--open)", borderRadius: 0 }} />Expected return date</span>
          </div>

          <div className="set-detail" aria-live="polite">
            {picked ? (
              <>
                <b>{flag(picked.country)} {countryName(picked.country)}</b> · {picked.product ?? "Product not named in notice"}
                <br />
                <span className="k">{FORM_LABEL[picked.form]} · </span>
                {picked.status === "anticipated" ? (
                  <>Anticipated from {fmtDate(picked.start)}</>
                ) : (
                  <>
                    {fmtDate(picked.start)} → {picked.end && picked.end <= today ? fmtDate(picked.end) : "ongoing"}
                    <span className="k"> ({duration(Math.round((ms(picked.end && picked.end <= today ? picked.end : today) - ms(picked.start)) / DAY))}{!picked.end || picked.end > today ? " so far" : ""})</span>
                    {picked.expected_end && (!picked.end || picked.end > today) && (
                      <span className="k">
                        {" · "}
                        {picked.expected_end < today
                          ? `was expected back ${fmtDate(picked.expected_end)} (overdue)`
                          : `expected back ${fmtDate(picked.expected_end)}`}
                      </span>
                    )}
                  </>
                )}
                {picked.source_url && /^https?:\/\//.test(picked.source_url) && (
                  <>
                    {" · "}
                    <a href={picked.source_url} target="_blank" rel="noopener noreferrer">regulator notice ↗</a>
                  </>
                )}
              </>
            ) : (
              <span className="k">Hover or tap a bar for the product, dates and the regulator&apos;s notice.</span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
