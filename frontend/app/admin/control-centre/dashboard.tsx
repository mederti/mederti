"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import type { ControlCentreData } from "@/lib/admin/control-centre-data";

/* ─── small helpers ────────────────────────────────────────────────── */

const fmt = (n: number) => n.toLocaleString("en-GB");
const dayLabel = (iso: string) =>
  new Date(iso + (iso.length === 10 ? "T00:00:00Z" : "")).toLocaleDateString("en-GB", {
    day: "numeric", month: "short", timeZone: "UTC",
  });
const ago = (iso: string) => {
  const mins = Math.max(1, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
};
const niceMax = (v: number) => {
  const p = Math.pow(10, Math.floor(Math.log10(v || 1)));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
  return 10 * p;
};

/* ─── charts (SVG, hover tooltips) ─────────────────────────────────── */

function AreaChart({ data, color, height = 190 }: {
  data: { date: string; value: number }[]; color: string; height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const gid = useId();
  const W = 720, H = height, padL = 44, padR = 14, padT = 12, padB = 24;
  const iw = W - padL - padR, ih = H - padT - padB;
  const max = niceMax(Math.max(1, ...data.map((p) => p.value)) * 1.08);
  const X = (i: number) => padL + (data.length === 1 ? 0 : (i / (data.length - 1)) * iw);
  const Y = (v: number) => padT + ih - (v / max) * ih;
  const divs = Number.isInteger(max / 4) && max / 4 >= 1 ? 4 : 3;
  if (data.length === 0) return null;

  let dLine = "";
  data.forEach((p, i) => { dLine += (i ? "L" : "M") + X(i).toFixed(1) + " " + Y(p.value).toFixed(1); });
  const dArea = dLine + `L${(padL + iw).toFixed(1)} ${padT + ih}L${padL} ${padT + ih}Z`;

  return (
    <div className="cc-chartwrap">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * W;
          setHover(Math.max(0, Math.min(data.length - 1, Math.round(((px - padL) / iw) * (data.length - 1)))));
        }}
      >
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.2" />
            <stop offset="100%" stopColor={color} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {Array.from({ length: divs + 1 }, (_, g) => {
          const y = padT + (ih * g) / divs;
          return (
            <g key={g}>
              <line x1={padL} x2={W - padR} y1={y} y2={y} stroke="#e4e7e5" />
              <text x={padL - 8} y={y + 3.5} textAnchor="end" className="cc-axis">
                {fmt(Math.round(max * (1 - g / divs)))}
              </text>
            </g>
          );
        })}
        {Array.from({ length: Math.min(6, data.length) }, (_, k) => {
          const nLab = Math.min(6, data.length);
          const i = Math.round((k / Math.max(1, nLab - 1)) * (data.length - 1));
          return (
            <text key={k} x={X(i)} y={H - 7} className="cc-axis"
              textAnchor={k === 0 ? "start" : k === nLab - 1 ? "end" : "middle"}>
              {dayLabel(data[i].date)}
            </text>
          );
        })}
        <path d={dArea} fill={`url(#${gid})`} />
        <path d={dLine} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
        <circle cx={X(data.length - 1)} cy={Y(data[data.length - 1].value)} r={3.5} fill={color} stroke="#fff" strokeWidth={2} />
        {hover !== null && (
          <g>
            <line x1={X(hover)} x2={X(hover)} y1={padT} y2={padT + ih} stroke="#c2c7c4" strokeDasharray="3 3" />
            <circle cx={X(hover)} cy={Y(data[hover].value)} r={4} fill={color} stroke="#fff" strokeWidth={2} />
          </g>
        )}
      </svg>
      {hover !== null && (
        <div className="cc-tip" style={{ left: `${(X(hover) / W) * 100}%` }}>
          <b>{dayLabel(data[hover].date)}</b> · {fmt(data[hover].value)}
        </div>
      )}
    </div>
  );
}

function IngestBars({ data }: { data: ControlCentreData["ingest"] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 720, H = 210, padL = 52, padR = 14, padT = 12, padB = 24;
  const iw = W - padL - padR, ih = H - padT - padB;
  const max = niceMax(Math.max(1, ...data.map((p) => p.new_events + p.verified)) * 1.05);
  const Y = (v: number) => padT + ih - (v / max) * ih;
  const slot = iw / Math.max(1, data.length), bw = Math.min(30, slot * 0.6);
  if (data.length === 0) return null;

  return (
    <div className="cc-chartwrap">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" onMouseLeave={() => setHover(null)}>
        {[0, 1, 2, 3].map((g) => {
          const y = padT + (ih * g) / 3;
          return (
            <g key={g}>
              <line x1={padL} x2={W - padR} y1={y} y2={y} stroke="#e4e7e5" />
              <text x={padL - 8} y={y + 3.5} textAnchor="end" className="cc-axis">
                {fmt(Math.round(max * (1 - g / 3)))}
              </text>
            </g>
          );
        })}
        {data.map((p, i) => {
          const x = padL + slot * i + (slot - bw) / 2;
          const yV = Y(p.verified), yTot = Y(p.verified + p.new_events);
          const hN = yV - yTot;
          return (
            <g key={p.date}>
              <rect x={x} y={yV} width={bw} height={padT + ih - yV} fill="#1baf7a" />
              {hN > 3 && <rect x={x} y={yTot} width={bw} height={hN - 2} rx={3} fill="#2a78d6" />}
              {i % 2 === 0 && (
                <text x={x + bw / 2} y={H - 7} textAnchor="middle" className="cc-axis">
                  {dayLabel(p.date)}
                </text>
              )}
              <rect x={padL + slot * i} y={padT} width={slot} height={ih} fill="transparent"
                onMouseEnter={() => setHover(i)} />
            </g>
          );
        })}
      </svg>
      {hover !== null && (
        <div className="cc-tip" style={{ left: `${((padL + slot * hover + slot / 2) / W) * 100}%` }}>
          <b>{dayLabel(data[hover].date)}</b> · {fmt(data[hover].new_events)} new · {fmt(data[hover].verified)} re-verified
        </div>
      )}
    </div>
  );
}

function HBars({ rows, color, max }: { rows: { name: string; value: number }[]; color: string; max?: number }) {
  const top = max ?? Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="cc-hbars">
      {rows.map((r) => (
        <div className="cc-hbar" key={r.name}>
          <span className="cc-hbar-name">{r.name}</span>
          <div className="cc-hbar-track">
            <div className="cc-hbar-fill" style={{ width: `${(r.value / top) * 100}%`, background: color }} />
          </div>
          <span className="cc-hbar-val">{fmt(r.value)}</span>
        </div>
      ))}
    </div>
  );
}

/* ─── dashboard ────────────────────────────────────────────────────── */

const RANGE_OPTIONS = [7, 30, 90] as const;

export default function ControlCentreDashboard({
  data, loading, onRefresh,
}: {
  data: ControlCentreData; loading: boolean; onRefresh: () => void;
}) {
  const [signupRange, setSignupRange] = useState<(typeof RANGE_OPTIONS)[number]>(30);
  const k = data.kpis;

  const kpis = [
    { label: "Active shortages", value: fmt(k.active_shortages), sub: `${fmt(k.anticipated)} anticipated · ${fmt(k.total_events)} all-time` },
    { label: "Countries reporting", value: fmt(k.countries_live), sub: "with ≥1 active shortage" },
    { label: "Events added · 7d", value: fmt(k.events_added_7d), sub: "new shortage records" },
    { label: "Registered users", value: fmt(k.users_total), sub: `+${fmt(k.signups_7d)} last 7 days` },
    { label: "Weekly active users", value: fmt(k.wau), sub: "signed in within 7 days" },
    { label: "Watchlist items", value: fmt(k.watchlist_items), sub: `${fmt(k.recalls_total)} recalls · ${fmt(k.drugs_total)} drugs` },
  ];

  return (
    <div className="cc-shell">
      <style>{CSS}</style>
      <header className="cc-head">
        <div>
          <h1>Control Centre</h1>
          <p className="cc-sub">Live from production · generated {ago(data.generated_at)}</p>
        </div>
        <div className="cc-head-right">
          <Link href="/admin/freshness" className="cc-link">Freshness detail</Link>
          <Link href="/admin/cohorts" className="cc-link">Cohorts</Link>
          <button className="cc-refresh" onClick={onRefresh} disabled={loading}>
            <RefreshCw size={14} className={loading ? "cc-spin" : undefined} /> Refresh
          </button>
        </div>
      </header>

      <div className="cc-kpis">
        {kpis.map((kpi) => (
          <div className="cc-card cc-kpi" key={kpi.label}>
            <span className="cc-kpi-label">{kpi.label}</span>
            <span className="cc-kpi-value">{kpi.value}</span>
            <span className="cc-kpi-sub">{kpi.sub}</span>
          </div>
        ))}
      </div>

      <div className="cc-grid">
        <div className="cc-colmain">
          <div className="cc-card">
            <div className="cc-card-head">
              <div>
                <h3>Pipeline writes per day</h3>
                <p className="cc-cap">New shortage events + re-verified records, last 14 days</p>
              </div>
              <div className="cc-legend">
                <span><i style={{ background: "#2a78d6" }} /> New events</span>
                <span><i style={{ background: "#1baf7a" }} /> Re-verified</span>
              </div>
            </div>
            <IngestBars data={data.ingest} />
          </div>

          <div className="cc-row">
            <div className="cc-card">
              <h3>Top countries by active shortages</h3>
              <p className="cc-cap">Open records right now</p>
              <HBars color="#2a78d6"
                rows={data.active_by_country.map((c) => ({ name: c.country, value: c.count }))} />
            </div>
            <div className="cc-card">
              <h3>Source freshness</h3>
              <p className="cc-cap">
                {fmt(data.freshness.ok)}/{fmt(data.freshness.total)} active sources fresh ·{" "}
                {fmt(data.freshness.stale)} stale · {fmt(data.freshness.never)} never reported
              </p>
              <HBars color="#0fa676" max={data.freshness.total}
                rows={[
                  { name: "< 6 h", value: data.freshness.buckets.under_6h },
                  { name: "6–24 h", value: data.freshness.buckets.h6_24 },
                  { name: "1–7 d", value: data.freshness.buckets.d1_7 },
                  { name: "> 7 d / dark", value: data.freshness.buckets.over_7d_or_dark },
                ]} />
              <p className="cc-note">
                Caveat: driven by <code>data_sources.last_scraped_at</code>, which not all
                scrapers update — &ldquo;never reported&rdquo; can mean the tracking column is
                unwired, not that the source is dead. See{" "}
                <Link href="/admin/freshness" className="cc-link">freshness detail</Link>.
              </p>
            </div>
          </div>

          <div className="cc-card">
            <div className="cc-card-head">
              <div>
                <h3>New signups per day</h3>
                <p className="cc-cap">Auth accounts created (email + Google OAuth)</p>
              </div>
              <div className="cc-chips" role="group" aria-label="Signup range">
                {RANGE_OPTIONS.map((r) => (
                  <button key={r} aria-pressed={signupRange === r} onClick={() => setSignupRange(r)}>
                    {r}d
                  </button>
                ))}
              </div>
            </div>
            <AreaChart color="#2a78d6"
              data={data.signups_daily.slice(-signupRange).map((p) => ({ date: p.date, value: p.count }))} />
          </div>

          <div className="cc-row">
            <div className="cc-card">
              <h3>Users by persona</h3>
              <p className="cc-cap">From user_profiles.role — {fmt(k.users_total)} accounts</p>
              <HBars color="#2a78d6"
                rows={data.personas.map((p) => ({ name: p.role.replace(/_/g, " "), value: p.count }))} />
            </div>
            <div className="cc-card">
              <h3>Latest signups</h3>
              <p className="cc-cap">Most recent accounts, emails masked</p>
              <div className="cc-list">
                {data.latest_signups.map((s, i) => (
                  <div className="cc-list-item" key={i}>
                    <div className="cc-grow">
                      <div className="cc-t">{s.masked_email}</div>
                      <div className="cc-d">{s.role ?? "no role set"}</div>
                    </div>
                    <span className="cc-when">{ago(s.created_at)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="cc-row">
            <div className="cc-card">
              <h3>Traffic</h3>
              {data.traffic.available ? (
                <>
                  <p className="cc-cap">{fmt(data.traffic.total_30d)} unique visitors · 30 days (PostHog)</p>
                  <AreaChart color="#eb6834"
                    data={data.traffic.daily.map((p) => ({ date: p.date, value: p.visitors }))} />
                </>
              ) : (
                <div className="cc-unwired">
                  <b>Not wired yet.</b> {data.traffic.reason}
                </div>
              )}
            </div>
            <div className="cc-card">
              <h3>Revenue</h3>
              <div className="cc-unwired">
                <b>Not wired yet.</b> {data.revenue.reason}
              </div>
            </div>
          </div>
        </div>

        <aside className="cc-rail">
          <div className="cc-card">
            <h3>System signals</h3>
            <p className="cc-cap">Derived from live queries + configured keys</p>
            <div className="cc-list">
              {data.systems.map((s) => (
                <div className="cc-list-item" key={s.name}>
                  <div className="cc-grow">
                    <div className="cc-t">{s.name}</div>
                    <div className="cc-d">{s.note}</div>
                  </div>
                  <span className={`cc-dot cc-dot-${s.status}`} title={s.status} />
                </div>
              ))}
            </div>
          </div>

          <div className="cc-card">
            <h3>Alerts</h3>
            <p className="cc-cap">Derived from freshness + pipeline signals</p>
            {data.alerts.length === 0 ? (
              <p className="cc-cap">No open alerts.</p>
            ) : (
              <div className="cc-list">
                {data.alerts.map((a, i) => (
                  <div className="cc-list-item" key={i}>
                    <span className={`cc-dot cc-sev-${a.severity}`} style={{ marginTop: 5 }} />
                    <div className="cc-grow">
                      <div className="cc-t">{a.title}</div>
                      <div className="cc-d">{a.detail}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="cc-card">
            <h3>Database at a glance</h3>
            <table className="cc-table">
              <tbody>
                <tr><td>Shortage events</td><td>{fmt(k.total_events)}</td></tr>
                <tr><td>· active</td><td>{fmt(k.active_shortages)}</td></tr>
                <tr><td>· anticipated</td><td>{fmt(k.anticipated)}</td></tr>
                <tr><td>Recalls</td><td>{fmt(k.recalls_total)}</td></tr>
                <tr><td>Drugs (canonical)</td><td>{fmt(k.drugs_total)}</td></tr>
                <tr><td>Watchlist items</td><td>{fmt(k.watchlist_items)}</td></tr>
              </tbody>
            </table>
          </div>
        </aside>
      </div>
    </div>
  );
}

/* ─── styles ───────────────────────────────────────────────────────── */

const CSS = `
.cc-shell { max-width: 1380px; margin: 0 auto; padding: 28px 24px 64px; color: #0e1512; }
.cc-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 20px; }
.cc-head h1 { font-size: 22px; font-weight: 700; margin: 0; letter-spacing: -0.01em; }
.cc-sub { font-size: 12.5px; color: #86908b; margin: 4px 0 0; }
.cc-head-right { display: flex; gap: 14px; align-items: center; }
.cc-link { font-size: 13px; color: #067a56; font-weight: 600; text-decoration: none; }
.cc-link:hover { text-decoration: underline; }
.cc-refresh { display: inline-flex; align-items: center; gap: 7px; font-size: 13px; font-weight: 600; padding: 7px 14px; border-radius: 8px; border: 1px solid rgba(14,21,18,0.12); background: #fff; cursor: pointer; }
.cc-refresh:disabled { opacity: 0.6; }
.cc-spin { animation: cc-rot 1s linear infinite; }
@keyframes cc-rot { to { transform: rotate(360deg); } }
.cc-card { background: #fdfefd; border: 1px solid rgba(14,21,18,0.10); border-radius: 12px; padding: 16px 18px; }
.cc-card h3 { margin: 0 0 2px; font-size: 13.5px; font-weight: 700; }
.cc-cap { font-size: 12px; color: #86908b; margin: 0 0 10px; }
.cc-note { font-size: 11.5px; color: #86908b; margin: 10px 0 0; line-height: 1.5; }
.cc-note code { font-size: 11px; }
.cc-kpis { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(196px, 1fr)); margin-bottom: 20px; }
.cc-kpi { display: flex; flex-direction: column; gap: 2px; }
.cc-kpi-label { font-size: 11px; font-weight: 700; letter-spacing: 0.07em; text-transform: uppercase; color: #86908b; }
.cc-kpi-value { font-size: 27px; font-weight: 700; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
.cc-kpi-sub { font-size: 12px; color: #4d5652; }
.cc-grid { display: grid; gap: 20px; grid-template-columns: minmax(0,1fr) 328px; align-items: start; }
@media (max-width: 1020px) { .cc-grid { grid-template-columns: minmax(0,1fr); } }
.cc-colmain { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
.cc-rail { display: flex; flex-direction: column; gap: 16px; }
.cc-row { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }
.cc-card-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; flex-wrap: wrap; margin-bottom: 8px; }
.cc-legend { display: flex; gap: 14px; font-size: 12px; color: #4d5652; }
.cc-legend span { display: inline-flex; align-items: center; gap: 6px; }
.cc-legend i { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }
.cc-chips { display: inline-flex; gap: 4px; background: #f0f3f2; border-radius: 8px; padding: 3px; }
.cc-chips button { font: 600 12px/1 inherit; color: #4d5652; background: transparent; border: 0; border-radius: 6px; padding: 5px 10px; cursor: pointer; }
.cc-chips button[aria-pressed="true"] { background: #fff; color: #0e1512; box-shadow: 0 1px 2px rgba(0,0,0,0.08); }
.cc-chartwrap { position: relative; }
.cc-chartwrap svg { display: block; width: 100%; }
.cc-axis { font-size: 11px; fill: #86908b; font-variant-numeric: tabular-nums; }
.cc-tip { position: absolute; top: 0; transform: translate(-50%, -6px); background: #0e1512; color: #f2f5f4; font-size: 12px; padding: 5px 9px; border-radius: 7px; white-space: nowrap; pointer-events: none; font-variant-numeric: tabular-nums; }
.cc-hbars { display: flex; flex-direction: column; gap: 9px; }
.cc-hbar { display: grid; grid-template-columns: 118px 1fr 52px; gap: 10px; align-items: center; font-size: 12.5px; }
.cc-hbar-name { color: #4d5652; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cc-hbar-track { height: 12px; background: #f0f3f2; border-radius: 4px; overflow: hidden; }
.cc-hbar-fill { height: 100%; border-radius: 4px; min-width: 2px; }
.cc-hbar-val { text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; }
.cc-list { display: flex; flex-direction: column; }
.cc-list-item { display: flex; align-items: flex-start; gap: 10px; padding: 9px 0; border-bottom: 1px solid #e2e6e4; font-size: 13px; }
.cc-list-item:last-child { border-bottom: 0; }
.cc-grow { flex: 1; min-width: 0; }
.cc-t { font-weight: 600; line-height: 1.35; }
.cc-d { color: #4d5652; font-size: 12px; line-height: 1.4; margin-top: 1px; }
.cc-when { font-size: 11.5px; color: #86908b; white-space: nowrap; font-variant-numeric: tabular-nums; }
.cc-dot { width: 9px; height: 9px; border-radius: 50%; flex: none; display: inline-block; margin-top: 4px; }
.cc-dot-ok { background: #0ca30c; }
.cc-dot-warn { background: #fab219; }
.cc-dot-down { background: #d03b3b; }
.cc-sev-critical { background: #d03b3b; }
.cc-sev-serious { background: #ec835a; }
.cc-sev-warning { background: #fab219; }
.cc-unwired { background: rgba(122,79,208,0.08); border: 1px dashed rgba(122,79,208,0.4); border-radius: 8px; padding: 10px 12px; font-size: 12.5px; color: #4d5652; line-height: 1.5; }
.cc-unwired b { color: #0e1512; }
.cc-table { border-collapse: collapse; width: 100%; font-size: 13px; }
.cc-table td { padding: 6px 0; border-bottom: 1px solid #e2e6e4; }
.cc-table tr:last-child td { border-bottom: 0; }
.cc-table td:last-child { text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; }
`;
