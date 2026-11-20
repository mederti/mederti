"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { truncateDrugName } from "@/lib/utils";

/**
 * Role-tailored rows under the search box + trending cards on the signed-in
 * home. One shared page for pharmacists and hospital procurement; the role on
 * `user_profiles` only decides WHICH rows show and in what order:
 *
 *   pharmacist   watchlist changes · official substitutions · recalls here
 *   procurement  watchlist changes · anticipated shortages · also short overseas
 *   default      watchlist changes · anticipated shortages · recalls here
 *   everyone     recalls from regulators worldwide
 *
 * Fed by POST /api/home-feed. Every item shows the source's own date and links
 * to the source; a row with no data hides itself rather than showing filler.
 * Must be rendered inside `.chome` (inherits its colour tokens).
 */

export type HomePersona = "pharmacist" | "procurement" | "default";

type Feed = {
  country: string;
  watchlist: {
    kind: "new" | "resolved" | "anticipated";
    date: string | null;
    drug_id: string;
    name: string;
    estimated_resolution_date: string | null;
    source_url: string | null;
  }[];
  anticipated: { total: number; items: { drug_id: string; name: string; start_date: string | null; source_url: string | null }[] };
  recalls: { total: number; items: Recall[] };
  substitutions: {
    drug_id: string; product: string; permitted_count: number; publisher: string;
    valid_from: string | null; valid_until: string | null; source_url: string;
  }[];
  multi_country: { complete: boolean; items: { drug_id: string; name: string; countries: string[] }[] };
  world_recalls: Recall[];
};

type Recall = {
  recall_id: string; drug_id: string | null; name: string; country_code: string;
  recall_class: string | null; announced_date: string; url: string | null; source_name: string | null;
};

// Dates always carry the year — "27 May" vs "May 27" was ambiguous on the cards.
function fmt(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  return isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

const WATCH_LABEL = {
  new: { text: "New shortage", cls: "crit" },
  resolved: { text: "Resolved", cls: "low" },
  anticipated: { text: "Anticipated", cls: "med" },
} as const;

function SourceLink({ href }: { href: string | null }) {
  if (!href) return null;
  return (
    <a className="hrr-src" href={href} target="_blank" rel="noopener noreferrer" aria-label="Open source">
      Source ↗
    </a>
  );
}

export default function HomeRoleRows({
  persona,
  country,
  drugIds,
  ready,
}: {
  persona: HomePersona;
  country: string;
  /** Watched drug ids for the signed-in user ([] when signed out / none). */
  drugIds: string[];
  /** False until the caller knows role + watchlist — avoids a double fetch. */
  ready: boolean;
}) {
  const [feed, setFeed] = useState<Feed | null>(null);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    fetch("/api/home-feed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ country, drug_ids: drugIds }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled && d) setFeed(d as Feed); })
      .catch(() => {});
    return () => { cancelled = true; };
    // drugIds is a fresh array each render; key on its contents.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, country, drugIds.join(",")]);

  if (!feed) return null;

  const watch = feed.watchlist.length > 0 && (
    <section className="hrr-sec" key="watch">
      <div className="hrr-head">
        <div className="hrr-label">Your watchlist · started or resolved in the last 14 days, and upcoming · {feed.country}</div>
        <Link href="/account" className="hrr-link">View watchlist →</Link>
      </div>
      <div className="hrr-list">
        {feed.watchlist.map((w, i) => {
          const l = WATCH_LABEL[w.kind];
          return (
            <div className="hrr-row" key={`${w.drug_id}-${w.kind}-${i}`}>
              <span className={`hrr-pill ${l.cls}`}>{l.text}</span>
              <Link href={`/drugs/${w.drug_id}`} className="hrr-name">{truncateDrugName(w.name, 48)}</Link>
              <span className="hrr-meta">
                {w.kind === "anticipated" ? `Starts ${fmt(w.date)}` : fmt(w.date)}
                {w.kind === "new" && w.estimated_resolution_date
                  ? ` · supply expected ${fmt(w.estimated_resolution_date)}`
                  : ""}
              </span>
              <SourceLink href={w.source_url} />
            </div>
          );
        })}
      </div>
    </section>
  );

  const anticipated = feed.anticipated.items.length > 0 && (
    <section className="hrr-sec" key="anticipated">
      <div className="hrr-head">
        <div className="hrr-label">Coming up · anticipated shortages · {feed.country}</div>
        <Link href={`/shortages?country=${feed.country}&status=anticipated`} className="hrr-link">
          See all anticipated →
        </Link>
      </div>
      <div className="hrr-list">
        {feed.anticipated.items.map((a, i) => (
          <div className="hrr-row" key={`${a.drug_id}-${i}`}>
            <span className="hrr-pill med">Starts {fmt(a.start_date)}</span>
            <Link href={`/drugs/${a.drug_id}`} className="hrr-name">{truncateDrugName(a.name, 48)}</Link>
            <span className="hrr-meta">Notified by the regulator</span>
            <SourceLink href={a.source_url} />
          </div>
        ))}
      </div>
    </section>
  );

  const recalls = feed.recalls.items.length > 0 && (
    <section className="hrr-sec" key="recalls">
      <div className="hrr-head">
        <div className="hrr-label">Recalls · {feed.country} · last 30 days</div>
        <Link href="/recalls" className="hrr-link">See all {feed.recalls.total.toLocaleString()} →</Link>
      </div>
      <div className="hrr-list">
        {feed.recalls.items.map((r) => (
          <div className="hrr-row" key={r.recall_id}>
            <span className="hrr-pill high">{r.recall_class ? `Class ${r.recall_class}` : "Recall"}</span>
            <span className="hrr-name">{truncateDrugName(r.name, 64)}</span>
            <span className="hrr-meta">{fmt(r.announced_date)}</span>
            <SourceLink href={r.url} />
          </div>
        ))}
      </div>
    </section>
  );

  const substitutions = feed.substitutions.length > 0 && (
    <section className="hrr-sec" key="subs">
      <div className="hrr-head">
        <div className="hrr-label">Official substitutions in force · {feed.country}</div>
      </div>
      <div className="hrr-list">
        {feed.substitutions.map((s) => (
          <div className="hrr-row" key={s.product}>
            <span className="hrr-pill low">
              {s.permitted_count} permitted substitute{s.permitted_count === 1 ? "" : "s"}
            </span>
            <Link href={`/drugs/${s.drug_id}`} className="hrr-name">{truncateDrugName(s.product, 64)}</Link>
            <span className="hrr-meta">
              {s.publisher}
              {s.valid_from ? ` · from ${fmt(s.valid_from)}` : ""}
              {s.valid_until ? ` to ${fmt(s.valid_until)}` : ""}
            </span>
            <SourceLink href={s.source_url} />
          </div>
        ))}
      </div>
    </section>
  );

  const multi = feed.multi_country.items.length > 0 && (
    <section className="hrr-sec" key="multi">
      <div className="hrr-head">
        <div className="hrr-label">
          Is it just us? · critical and high {feed.country} shortages also active overseas
        </div>
        <Link href="/map" className="hrr-link">Open map →</Link>
      </div>
      <div className="hrr-list">
        {feed.multi_country.items.map((m) => (
          <div className="hrr-row" key={m.drug_id}>
            <span className="hrr-pill neutral">
              {feed.multi_country.complete ? "" : "at least "}{m.countries.length} countries
            </span>
            <Link href={`/drugs/${m.drug_id}`} className="hrr-name">{truncateDrugName(m.name, 40)}</Link>
            <span className="hrr-meta hrr-ctry">{m.countries.join(" · ")}</span>
          </div>
        ))}
      </div>
    </section>
  );

  const world = feed.world_recalls.length > 0 && (
    <section className="hrr-sec" key="world">
      <div className="hrr-head">
        <div className="hrr-label">From the regulators · recalls and withdrawals worldwide · last 14 days</div>
        <Link href="/recalls" className="hrr-link">All recalls →</Link>
      </div>
      <div className="hrr-news">
        {feed.world_recalls.map((r) => {
          const inner = (
            <>
              <div className="hrr-news-title">
                {r.recall_class && r.recall_class !== "Unclassified" ? `Class ${r.recall_class} recall: ` : ""}
                {truncateDrugName(r.name, 70)}
              </div>
              <div className="hrr-meta">
                {r.country_code} · {r.source_name ?? "Regulator"} · {fmt(r.announced_date)}
              </div>
            </>
          );
          return r.url
            ? <a key={r.recall_id} className="hrr-news-item" href={r.url} target="_blank" rel="noopener noreferrer">{inner}</a>
            : <div key={r.recall_id} className="hrr-news-item">{inner}</div>;
        })}
      </div>
    </section>
  );

  const byRole =
    persona === "pharmacist" ? [watch, substitutions, recalls]
    : persona === "procurement" ? [watch, anticipated, multi]
    : [watch, anticipated, recalls];

  return (
    <div className="hrr">
      <style>{CSS}</style>
      {byRole}
      {world}
    </div>
  );
}

const CSS = `
.hrr-sec{margin-top:34px}
.hrr-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:11px;padding:0 2px}
.hrr-label{font-size:10.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--ch-text-4)}
.hrr-link{font-size:12px;color:var(--ch-text-3);text-decoration:none;white-space:nowrap}
.hrr-link:hover{color:var(--ch-teal-d)}
.hrr-list{background:var(--ch-bg);border:1px solid var(--ch-border);border-radius:12px;padding:2px 14px}
.hrr-row{display:flex;align-items:center;gap:11px;padding:10px 0;border-top:1px solid var(--ch-border);font-size:13px;min-width:0}
.hrr-row:first-child{border-top:0}
.hrr-pill{flex-shrink:0;font-size:10.5px;font-weight:600;padding:3px 8px;border-radius:6px;white-space:nowrap}
.hrr-pill.crit{background:var(--ch-crit-bg);color:var(--ch-crit);border:1px solid var(--ch-crit-b)}
.hrr-pill.high{background:var(--ch-high-bg);color:var(--ch-high);border:1px solid var(--ch-high-b)}
.hrr-pill.med{background:var(--ch-med-bg);color:var(--ch-med);border:1px solid var(--ch-med-b)}
.hrr-pill.low{background:var(--ch-low-bg);color:var(--ch-low);border:1px solid var(--ch-low-b)}
.hrr-pill.neutral{background:var(--ch-bg-2);color:var(--ch-text-3);border:1px solid var(--ch-border)}
.hrr-name{flex:1;min-width:0;font-weight:600;color:var(--ch-text);text-decoration:none;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
a.hrr-name:hover{color:var(--ch-teal-d)}
.hrr-meta{font-size:11.5px;color:var(--ch-text-3);white-space:nowrap}
.hrr-ctry{max-width:46%;overflow:hidden;text-overflow:ellipsis}
.hrr-src{flex-shrink:0;font-size:11.5px;color:var(--ch-text-4);text-decoration:none;white-space:nowrap}
.hrr-src:hover{color:var(--ch-teal-d)}
.hrr-news{display:grid;grid-template-columns:1fr 1fr;gap:9px}
.hrr-news-item{display:block;background:var(--ch-bg);border:1px solid var(--ch-border);border-radius:11px;
  padding:12px 14px;text-decoration:none;color:inherit;transition:.15s;min-width:0}
a.hrr-news-item:hover{border-color:var(--ch-teal)}
.hrr-news-title{font-size:13px;font-weight:600;line-height:1.4;margin-bottom:4px;color:var(--ch-text)}
.hrr-news-item .hrr-meta{white-space:normal}
@media(max-width:640px){
  .hrr-news{grid-template-columns:1fr}
  .hrr-row{flex-wrap:wrap}
  .hrr-name{flex-basis:100%;order:-1}
  .hrr-ctry{max-width:100%}
}
`;
