// "What to dispense instead" — the Substitution Agent's answer on the drug
// page (lib/substitution/rank.ts). Ranking, legal wording and dose rules are
// decided in the engine; this only lays them out: one recommendation first,
// then the alternates, then the sources. Never adds a dose or a permission
// the engine didn't return.
import type { SubstitutionAnswer, SubstitutionOption, Tier } from "@/lib/substitution/rank";

const TIER_LABEL: Record<Tier, string> = {
  authorised_swap: "Authorised swap",
  same_medicine: "Same medicine",
  import_pathway: "Import approval",
  therapeutic: "Different medicine",
};

const PRESCRIBER: Record<SubstitutionOption["needs_prescriber"], string> = {
  no: "No new prescription needed",
  check: "Check your dispensing rules",
  yes: "Prescriber decision",
};

const SHOWN = 4;

function asOf(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso.slice(0, 10) + "T00:00:00Z").toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

function SourceLine({ o }: { o: SubstitutionOption }) {
  const s = o.source;
  const date = asOf(s.as_of);
  const label = [s.publisher, s.ref].filter(Boolean).join(" ");
  return (
    <div className="si-src">
      {s.url ? <a href={s.url} target="_blank" rel="noopener noreferrer">{label}</a> : label}
      {date ? ` · checked ${date}` : ""}
    </div>
  );
}

function Option({ o, primary }: { o: SubstitutionOption; primary?: boolean }) {
  return (
    <div className={`si-opt${primary ? " si-primary" : ""}`}>
      <div className="si-head">
        <span className={`si-tier si-${o.tier}`}>{TIER_LABEL[o.tier]}</span>
        <span className={`si-rx si-rx-${o.needs_prescriber}`}>{PRESCRIBER[o.needs_prescriber]}</span>
      </div>
      <div className="si-what">{o.headline}</div>
      {o.applies_to && <div className="si-for">For: {o.applies_to}</div>}
      <div className="si-legal">{o.legal_basis}</div>
      {o.quote && <blockquote className="si-quote">{o.quote}</blockquote>}
      <SourceLine o={o} />
    </div>
  );
}

export function SubstitutionSection({ answer, countryName }: { answer: SubstitutionAnswer; countryName: string }) {
  const [rec, ...rest] = answer.options;
  return (
    <div className="sec" id="instead">
      <style>{CSS}</style>
      <div className="sec-title">
        What to dispense instead <span className="help">{countryName} · ranked from regulator instruments, notices and registers</span>
      </div>

      {rec ? (
        <>
          <Option o={rec} primary />
          <div className="si-dose">
            <span className="si-dose-l">Dose</span>
            {answer.dose.statement
              ? <span><q>{answer.dose.statement}</q> <span className="si-muted">{answer.dose.note}</span></span>
              : <span className="si-muted">{answer.dose.note}</span>}
          </div>
        </>
      ) : (
        <div className="si-refusal">
          <div className="si-what">No substitute on file for {countryName}</div>
          <div className="si-legal">{answer.refusal?.reason}</div>
          {answer.refusal && answer.refusal.references.length > 0 && (
            <div className="si-refs">
              Check:{" "}
              {answer.refusal.references.map((r, i) => (
                <span key={r.name}>
                  {i > 0 ? " · " : ""}
                  {r.url ? <a href={r.url} target="_blank" rel="noopener noreferrer">{r.name}</a> : r.name}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {answer.recalls.length > 0 && (
        <div className="si-recall">
          <b>Active recall{answer.recalls.length > 1 ? "s" : ""} in {countryName}:</b>{" "}
          {answer.recalls.slice(0, 3).map((r, i) => (
            <span key={i}>
              {i > 0 ? "; " : ""}
              {r.press_release_url ? <a href={r.press_release_url} target="_blank" rel="noopener noreferrer">{r.brand_name ?? r.generic_name ?? "product"}</a> : r.brand_name ?? r.generic_name ?? "product"}
              {r.recall_class ? ` (${r.recall_class})` : ""}
            </span>
          ))}
          . Check the recommended product isn&apos;t affected.
        </div>
      )}

      {rest.length > 0 && (
        <div className="si-more">
          <div className="si-more-h">Other options</div>
          {rest.slice(0, SHOWN).map((o, i) => <Option key={i} o={o} />)}
          {rest.length > SHOWN && (
            <details className="si-all">
              <summary>{rest.length - SHOWN} more option{rest.length - SHOWN > 1 ? "s" : ""}</summary>
              {rest.slice(SHOWN).map((o, i) => <Option key={i} o={o} />)}
            </details>
          )}
        </div>
      )}

      {answer.coverage_note && <div className="si-muted si-foot">{answer.coverage_note}</div>}
      <div className="si-muted si-foot">
        &quot;No shortage notice on file&quot; means we hold no notice, not that stock is on the shelf. Doses are quoted only where the source states one.
      </div>
    </div>
  );
}

const CSS = `
.si-opt{border:1px solid var(--border);border-radius:12px;padding:12px 14px;background:var(--bg);margin-top:8px}
.si-primary{border-color:var(--green);box-shadow:var(--sh-card)}
.si-head{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:6px}
.si-tier,.si-rx{font-size:10.5px;font-weight:600;padding:2px 8px;border-radius:99px;border:1px solid var(--border);color:var(--text-3);background:var(--bg-3)}
.si-authorised_swap{color:var(--green-d);border-color:var(--green);background:var(--green-bg)}
.si-same_medicine{color:var(--green-d);border-color:var(--ok-b);background:var(--ok-bg)}
.si-import_pathway{color:var(--violet);border-color:var(--violet-b);background:#eef0ff}
.si-therapeutic{color:var(--med);border-color:var(--med-b);background:var(--med-bg)}
.si-rx-no{color:var(--green-d)}
.si-rx-yes{color:var(--med)}
.si-what{font-weight:600;font-size:14.5px;color:var(--ink);line-height:1.35}
.si-for{font-size:12px;color:var(--text-3);margin-top:2px}
.si-legal{font-size:12.5px;color:var(--text-2);margin-top:6px;line-height:1.45}
.si-quote{margin:6px 0 0;padding-left:10px;border-left:2px solid var(--border);font-size:12px;line-height:1.45;color:var(--text-3)}
.si-src{font-size:11.5px;color:var(--text-4);margin-top:6px}
.si-src a,.si-refs a,.si-recall a{color:var(--green)}
.si-dose{display:flex;gap:10px;align-items:baseline;margin-top:8px;padding:9px 14px;border-radius:10px;background:var(--bg-3);font-size:12.5px;color:var(--text-2)}
.si-dose-l{font-weight:700;font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--text-3)}
.si-muted{color:var(--text-3)}
.si-refusal{border:1px dashed var(--border-2);border-radius:12px;padding:12px 14px;background:var(--bg)}
.si-refs{font-size:12.5px;margin-top:6px;color:var(--text-2)}
.si-recall{margin-top:8px;padding:9px 14px;border-radius:10px;background:var(--crit-bg);border:1px solid var(--crit-b);font-size:12.5px;color:var(--text-2)}
.si-more{margin-top:14px}
.si-more-h{font-size:10.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--text-4)}
.si-all summary{cursor:pointer;font-size:12.5px;color:var(--green-d);margin-top:8px}
.si-foot{font-size:11.5px;margin-top:10px}
@media (max-width:640px){.si-dose{flex-direction:column;gap:2px}}
`;
