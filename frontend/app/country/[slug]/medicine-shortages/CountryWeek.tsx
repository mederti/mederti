import MedicineLink from "./MedicineLink";
import type { CountryWeek as Week, WeekBucket } from "@/lib/country-profile";

const d = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

const SHOWN = 6;

function Column({
  title,
  color,
  bucket,
  empty,
}: {
  title: string;
  color: string;
  bucket: WeekBucket;
  empty: string;
}) {
  const shown = bucket.items.slice(0, SHOWN);
  const rest = (bucket.medicines ?? bucket.items.length) - shown.length;
  return (
    <div style={{ flex: "1 1 220px", minWidth: 0, padding: "14px 16px", border: "1px solid var(--app-border, #e8ecf0)", borderRadius: 12, background: "#fff" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em", color }}>
          {bucket.notices === null ? "—" : bucket.notices.toLocaleString()}
        </span>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{title}</span>
      </div>
      <div style={{ fontSize: 12, color: "var(--app-text-3, #6a7280)", margin: "2px 0 8px" }}>
        {bucket.notices
          ? `notice${bucket.notices === 1 ? "" : "s"}${bucket.medicines !== null ? ` · ${bucket.medicines} medicine${bucket.medicines === 1 ? "" : "s"}` : ""}`
          : empty}
      </div>
      {shown.length > 0 && (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, fontSize: 13.5, lineHeight: 1.9 }}>
          {shown.map((i) => (
            <li key={i.medicine} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <MedicineLink
                slug={i.slug}
                drugId={i.drugId}
                style={{ color: "var(--teal, #127A63)", textDecoration: "none", fontWeight: 500, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
              >
                {i.medicine}
              </MedicineLink>
              <span style={{ color: "var(--app-text-3, #98a1ac)", whiteSpace: "nowrap", fontSize: 12.5 }}>
                {i.date ? d(i.date) : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
      {rest > 0 && (
        <div style={{ fontSize: 12.5, color: "var(--app-text-3, #6a7280)", marginTop: 4 }}>+ {rest} more</div>
      )}
    </div>
  );
}

/**
 * "What changed this week" — movements by the regulator's own dates. Server
 * component: the names are in the HTML for crawlers and AI retrieval.
 */
export default function CountryWeek({ name, week }: { name: string; week: Week }) {
  const nothing = !week.started.notices && !week.resolved.notices && !week.startingSoon.notices;
  return (
    <section style={{ marginTop: 36 }}>
      <h2 style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.02em", margin: "0 0 4px" }}>
        What changed this week in {name}
      </h2>
      <p style={{ fontSize: 13, color: "var(--app-text-3, #6a7280)", margin: "0 0 12px", lineHeight: 1.55 }}>
        {d(week.from)} – {d(week.to)}, by the regulator&rsquo;s own start and end dates.
        {nothing ? ` No notices in ${name} started, ended or are due to start in this window.` : ""}
      </p>
      {!nothing && (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <Column title="New shortages" color="#b42318" bucket={week.started} empty="none started this week" />
          <Column title="Resolved" color="#0B5A49" bucket={week.resolved} empty="none closed by the regulator this week" />
          <Column
            title={`Starting by ${d(week.soonTo)}`}
            color="#b54708"
            bucket={week.startingSoon}
            empty="none announced for the next 14 days"
          />
        </div>
      )}
    </section>
  );
}
