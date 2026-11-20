import {
  getControlCentreData,
  fetchWeeklyTraffic,
  type NamedCount,
} from "@/lib/admin/control-centre-data";

/**
 * Weekly co-founder report — users + site traffic, built from exactly the
 * same queries as /admin/control-centre so the email and the dashboard can
 * never disagree.
 *
 * Accuracy rules (do not relax):
 *  - The reporting week is the last 7 COMPLETE UTC days; every section says
 *    which dates or which moment it covers.
 *  - "Users" are external accounts only (test/staff excluded, count shown).
 *  - Traffic cannot be bot-filtered, so the crawler-heavy share is printed
 *    next to the total instead of being subtracted.
 *  - If any underlying query fails this throws — no email goes out rather
 *    than one with zeros in it.
 */

const DAY = 86_400_000;
const dayKey = (d: Date) => d.toISOString().slice(0, 10);
const fmt = (n: number) => n.toLocaleString("en-GB");
const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const longDate = (iso: string) =>
  new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

function delta(now: number, prev: number): string {
  if (prev === 0) return now === 0 ? "no change" : "previous week: 0";
  const pct = ((now - prev) / prev) * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(0)}% vs previous week (${fmt(prev)})`;
}

export async function buildWeeklyReport(nowMs = Date.now()) {
  const until = dayKey(new Date(nowMs - DAY));
  const since = dayKey(new Date(nowMs - 7 * DAY));
  const prevSince = dayKey(new Date(nowMs - 14 * DAY));

  const [cc, traffic] = await Promise.all([getControlCentreData(), fetchWeeklyTraffic(since, until)]);

  const inRange = (d: string, a: string, b: string) => d >= a && d <= b;
  const signups_week = cc.signups_daily.filter((d) => inRange(d.date, since, until)).reduce((a, d) => a + d.count, 0);
  const signups_prev = cc.signups_daily
    .filter((d) => d.date >= prevSince && d.date < since)
    .reduce((a, d) => a + d.count, 0);
  const new_accounts = cc.latest_signups.filter((s) => inRange(s.created_at.slice(0, 10), since, until));

  const stats = {
    window: { since, until },
    users: {
      total_external: cc.kpis.users_total,
      internal_excluded: cc.kpis.users_internal,
      signups_week,
      signups_prev,
      active_last_7d: cc.kpis.wau,
      never_signed_in: cc.kpis.never_signed_in,
      personas: cc.personas,
      new_accounts,
    },
    traffic,
    data: {
      active_notices: cc.kpis.active_shortages,
      countries: cc.kpis.countries_live,
      sources_fresh: cc.freshness.ok,
      sources_total: cc.freshness.total,
    },
    alerts: cc.alerts,
    generated_at: cc.generated_at,
  };

  const range = `${longDate(since)} – ${longDate(until)}`;
  const subject = `Mederti weekly: ${fmt(signups_week)} new user${signups_week === 1 ? "" : "s"}, ${
    traffic.available ? `${fmt(traffic.week.visitors)} visitors` : "traffic unavailable"
  } (${range})`;

  // ── HTML ──
  const h2 = (t: string) => `<h2 style="font-size:15px;margin:28px 0 4px;color:#090E2C">${esc(t)}</h2>`;
  const cap = (t: string) => `<p style="font-size:12px;color:#6b7570;margin:0 0 10px">${t}</p>`;
  const row = (k: string, v: string, note = "") =>
    `<tr><td style="padding:6px 0;border-bottom:1px solid #eceeed;font-size:13px;color:#39423e">${esc(k)}</td>` +
    `<td style="padding:6px 0;border-bottom:1px solid #eceeed;font-size:13px;text-align:right;white-space:nowrap"><b>${esc(v)}</b></td>` +
    `<td style="padding:6px 0 6px 12px;border-bottom:1px solid #eceeed;font-size:12px;color:#6b7570">${esc(note)}</td></tr>`;
  const table = (rows: string) => `<table style="width:100%;border-collapse:collapse">${rows}</table>`;
  const list = (title: string, items: NamedCount[]) =>
    `<p style="font-size:12px;font-weight:600;margin:14px 0 2px;color:#39423e">${esc(title)}</p>` +
    (items.length
      ? table(items.map((i) => row(i.name, fmt(i.value))).join(""))
      : `<p style="font-size:12px;color:#6b7570;margin:0">None recorded</p>`);

  let html = `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:640px;margin:0 auto;padding:24px;color:#090E2C">`;
  html += `<h1 style="font-size:20px;margin:0 0 2px">Mederti weekly report</h1>`;
  html += cap(`Week of ${esc(range)} (7 complete UTC days). Generated ${esc(cc.generated_at.slice(0, 16).replace("T", " "))} UTC from production.`);

  html += h2("Users");
  html += cap(
    `External accounts only — ${fmt(stats.users.internal_excluded)} test and staff accounts (mederti.test, mederti.com) are excluded from every figure.`,
  );
  html += table(
    row("New signups this week", fmt(signups_week), delta(signups_week, signups_prev)) +
      row("Registered users", fmt(stats.users.total_external), "all time, as of generation") +
      row("Active users", fmt(stats.users.active_last_7d), "last sign-in within the 7 days before generation") +
      row("Never signed in", fmt(stats.users.never_signed_in), "accounts created but no sign-in recorded"),
  );
  html += list(
    "Registered users by role",
    stats.users.personas.map((p) => ({ name: p.role.replace(/_/g, " "), value: p.count })),
  );
  if (signups_week > 0) {
    html += `<p style="font-size:12px;font-weight:600;margin:14px 0 2px;color:#39423e">This week's signups (emails masked)</p>`;
    html += table(new_accounts.map((s) => row(s.masked_email, s.role ?? "no profile yet", s.created_at.slice(0, 10))).join(""));
    if (new_accounts.length < signups_week) {
      html += cap(`Showing the ${new_accounts.length} most recent of ${fmt(signups_week)}.`);
    }
  }

  html += h2("Site traffic");
  if (traffic.available) {
    html += cap(
      `Vercel Web Analytics, production. Visitors are de-duplicated across the week. Bots are <b>not</b> filtered out.`,
    );
    html += table(
      row("Visitors", fmt(traffic.week.visitors), delta(traffic.week.visitors, traffic.previous.visitors)) +
        row("Page views", fmt(traffic.week.views), delta(traffic.week.views, traffic.previous.views)),
    );
    if (traffic.crawler_heavy_visitors > 0) {
      html += `<p style="font-size:12px;background:#fff7e6;border:1px solid #f1d9a5;border-radius:6px;padding:8px 10px;margin:10px 0;color:#6b4e0f">` +
        `Caveat: ${fmt(traffic.crawler_heavy_visitors)} of this week's visitors are from Singapore, China and Hong Kong, ` +
        `where a crawler spike began on 9 Nov 2026 and produced no signups. Treat the visitor total as an upper bound on people.</p>`;
    }
    html += list("Top pages (visitors)", traffic.top_pages);
    html += list("Top referrers (visitors)", traffic.top_referrers);
    html += list("Top countries (visitors)", traffic.top_countries);
  } else {
    html += cap(`Traffic figures are unavailable this week: ${esc(traffic.reason)} No traffic numbers are shown rather than estimated.`);
  }

  html += h2("Data platform");
  html += cap("Snapshot at generation time.");
  html += table(
    row("Active shortage notices", fmt(stats.data.active_notices), "open regulator notices; recall-derived rows excluded") +
      row("Countries reporting", fmt(stats.data.countries), "with at least one active notice") +
      row("Sources fresh", `${fmt(stats.data.sources_fresh)} / ${fmt(stats.data.sources_total)}`, "active sources scraped within their expected cadence"),
  );
  if (cc.alerts.length) {
    html += `<p style="font-size:12px;font-weight:600;margin:14px 0 2px;color:#39423e">Open alerts</p>`;
    html += table(cc.alerts.map((a) => row(a.title, "", a.detail)).join(""));
  }

  html += `<p style="font-size:12px;color:#6b7570;margin-top:28px">Live detail: <a href="https://www.mederti.com/admin/control-centre">mederti.com/admin/control-centre</a> (admin sign-in required).</p></div>`;

  return { subject, html, stats };
}
