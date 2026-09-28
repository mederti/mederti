"use client";

import { useState } from "react";

/* Hand-curated source registry. Statuses are honest and maintained by hand —
   degraded/offline/blocked sources are shown, not hidden. Update this list
   when a scraper's real-world health changes (see cron/crontab_fixed.txt and
   CLAUDE.md "Scraper Coverage" for the source of truth). */
type Status = "live" | "degraded" | "offline" | "blocked";
type Source = {
  flag: string;
  country: string;
  authority: string;
  fullName: string;
  signals: ("S" | "R" | "P")[];
  cadence: string;
  note: string;
  status: Status;
};

const SOURCES: Source[] = [
  { flag: "🇦🇺", country: "Australia", authority: "TGA", fullName: "Therapeutic Goods Administration", signals: ["S", "R"], cadence: "daily", note: "audited daily", status: "live" },
  { flag: "🇺🇸", country: "United States", authority: "FDA", fullName: "Food and Drug Administration", signals: ["S", "R", "P"], cadence: "daily", note: "high-volume", status: "live" },
  { flag: "🇬🇧", country: "United Kingdom", authority: "MHRA", fullName: "Medicines & Healthcare products Regulatory Agency", signals: ["S", "R", "P"], cadence: "daily", note: "", status: "live" },
  { flag: "🇪🇺", country: "European Union", authority: "EMA", fullName: "European Medicines Agency (union-wide list)", signals: ["S", "R"], cadence: "daily", note: "EU backstop", status: "live" },
  { flag: "🇨🇦", country: "Canada", authority: "Health Canada", fullName: "Drug Shortages Canada", signals: ["S", "R"], cadence: "daily", note: "tier-3 flagged", status: "live" },
  { flag: "🇩🇪", country: "Germany", authority: "BfArM", fullName: "Bundesinstitut für Arzneimittel und Medizinprodukte", signals: ["S", "R"], cadence: "daily", note: "", status: "live" },
  { flag: "🇫🇷", country: "France", authority: "ANSM", fullName: "Agence nationale de sécurité du médicament", signals: ["S", "R", "P"], cadence: "daily", note: "", status: "live" },
  { flag: "🇮🇹", country: "Italy", authority: "AIFA", fullName: "Agenzia Italiana del Farmaco", signals: ["S", "R", "P"], cadence: "daily", note: "", status: "live" },
  { flag: "🇪🇸", country: "Spain", authority: "AEMPS", fullName: "Agencia Española de Medicamentos", signals: ["S", "R", "P"], cadence: "daily", note: "", status: "live" },
  { flag: "🇯🇵", country: "Japan", authority: "PMDA", fullName: "Pharmaceuticals and Medical Devices Agency", signals: ["S"], cadence: "daily", note: "", status: "live" },
  { flag: "🇰🇷", country: "South Korea", authority: "MFDS", fullName: "Ministry of Food and Drug Safety", signals: ["S"], cadence: "daily", note: "", status: "live" },
  { flag: "🇨🇭", country: "Switzerland", authority: "Swissmedic", fullName: "Swiss Agency for Therapeutic Products", signals: ["S"], cadence: "daily", note: "", status: "live" },
  { flag: "🇳🇱", country: "Netherlands", authority: "CBG-MEB", fullName: "Medicines Evaluation Board", signals: ["S"], cadence: "daily", note: "", status: "live" },
  { flag: "🇸🇬", country: "Singapore", authority: "HSA", fullName: "Health Sciences Authority", signals: ["S"], cadence: "daily", note: "", status: "live" },
  { flag: "🇳🇿", country: "New Zealand", authority: "Medsafe · Pharmac", fullName: "Medsafe / Pharmac (two sources)", signals: ["S", "R"], cadence: "daily", note: "", status: "live" },
  { flag: "🇧🇷", country: "Brazil", authority: "ANVISA", fullName: "Agência Nacional de Vigilância Sanitária", signals: ["S"], cadence: "—", note: "API discontinued", status: "offline" },
  { flag: "🇧🇦", country: "Bosnia & Herz.", authority: "ALMBIH", fullName: "Agency for Medicinal Products", signals: ["S"], cadence: "daily", note: "page 1 of register", status: "degraded" },
  { flag: "🇪🇪", country: "Estonia", authority: "Ravimiamet", fullName: "State Agency of Medicines", signals: ["S"], cadence: "daily", note: "newsworthy subset", status: "degraded" },
  { flag: "🇱🇹", country: "Lithuania", authority: "VVKT", fullName: "State Medicines Control Agency", signals: ["S"], cadence: "daily", note: "access blocked", status: "blocked" },
  // — collapsed below the fold —
  { flag: "🇦🇹", country: "Austria", authority: "AGES", fullName: "Agentur für Gesundheit und Ernährungssicherheit", signals: ["S"], cadence: "daily", note: "", status: "live" },
  { flag: "🇧🇪", country: "Belgium", authority: "FAMHP", fullName: "Federal Agency for Medicines and Health Products", signals: ["S"], cadence: "daily", note: "", status: "live" },
  { flag: "🇩🇰", country: "Denmark", authority: "DKMA", fullName: "Danish Medicines Agency", signals: ["S"], cadence: "daily", note: "", status: "live" },
  { flag: "🇫🇮", country: "Finland", authority: "Fimea", fullName: "Finnish Medicines Agency", signals: ["S"], cadence: "daily", note: "", status: "live" },
  { flag: "🇸🇪", country: "Sweden", authority: "Läkemedelsverket", fullName: "Swedish Medical Products Agency", signals: ["S"], cadence: "daily", note: "", status: "live" },
  { flag: "🇳🇴", country: "Norway", authority: "NOMA", fullName: "Norwegian Medicines Agency", signals: ["S"], cadence: "daily", note: "", status: "live" },
  { flag: "🇮🇪", country: "Ireland", authority: "HPRA", fullName: "Health Products Regulatory Authority", signals: ["S"], cadence: "daily", note: "", status: "live" },
  { flag: "🇨🇿", country: "Czechia", authority: "SÚKL", fullName: "State Institute for Drug Control", signals: ["S"], cadence: "daily", note: "", status: "live" },
  { flag: "🇸🇰", country: "Slovakia", authority: "ŠÚKL", fullName: "State Institute for Drug Control", signals: ["S"], cadence: "daily", note: "", status: "live" },
  { flag: "🇭🇺", country: "Hungary", authority: "OGYÉI", fullName: "National Institute of Pharmacy and Nutrition", signals: ["S"], cadence: "daily", note: "", status: "live" },
  { flag: "🇵🇱", country: "Poland", authority: "MZ", fullName: "Ministry of Health (anti-shortage list)", signals: ["S"], cadence: "daily", note: "", status: "live" },
  { flag: "🇵🇹", country: "Portugal", authority: "INFARMED", fullName: "National Authority of Medicines", signals: ["S"], cadence: "daily", note: "", status: "live" },
  { flag: "🇬🇷", country: "Greece", authority: "EOF", fullName: "National Organization for Medicines", signals: ["S"], cadence: "daily", note: "", status: "live" },
  { flag: "🇸🇮", country: "Slovenia", authority: "JAZMP", fullName: "Agency for Medicinal Products", signals: ["S"], cadence: "daily", note: "2,238 events", status: "live" },
  { flag: "🇭🇷", country: "Croatia", authority: "HALMED", fullName: "Agency for Medicinal Products", signals: ["S"], cadence: "daily", note: "277 events", status: "live" },
  { flag: "🇷🇴", country: "Romania", authority: "ANMDMR", fullName: "National Agency for Medicines", signals: ["S"], cadence: "daily", note: "769 events", status: "live" },
  { flag: "🇱🇻", country: "Latvia", authority: "ZVA", fullName: "State Agency of Medicines", signals: ["S"], cadence: "daily", note: "1,063 events", status: "live" },
  { flag: "🇮🇸", country: "Iceland", authority: "Lyfjastofnun", fullName: "Icelandic Medicines Agency", signals: ["S"], cadence: "daily", note: "2,855 events", status: "live" },
  { flag: "🇹🇷", country: "Türkiye", authority: "TİTCK", fullName: "Turkish Medicines and Medical Devices Agency", signals: ["S"], cadence: "daily", note: "", status: "live" },
  { flag: "🇨🇳", country: "China", authority: "NMPA", fullName: "National Medical Products Administration", signals: ["S"], cadence: "daily", note: "", status: "live" },
  { flag: "🇭🇰", country: "Hong Kong", authority: "Drug Office", fullName: "Department of Health Drug Office", signals: ["S"], cadence: "daily", note: "", status: "live" },
  { flag: "🇹🇼", country: "Taiwan", authority: "TFDA", fullName: "Taiwan Food and Drug Administration", signals: ["S"], cadence: "daily", note: "", status: "live" },
  { flag: "🇹🇭", country: "Thailand", authority: "Thai FDA", fullName: "Food and Drug Administration", signals: ["S"], cadence: "daily", note: "160 events", status: "live" },
  { flag: "🇲🇾", country: "Malaysia", authority: "NPRA", fullName: "National Pharmaceutical Regulatory Agency", signals: ["S"], cadence: "daily", note: "", status: "live" },
  { flag: "🇮🇳", country: "India", authority: "CDSCO", fullName: "Central Drugs Standard Control Organisation", signals: ["S"], cadence: "daily", note: "", status: "live" },
  { flag: "🇱🇰", country: "Sri Lanka", authority: "NMRA", fullName: "National Medicines Regulatory Authority", signals: ["S"], cadence: "daily", note: "", status: "live" },
  { flag: "🇸🇦", country: "Saudi Arabia", authority: "SFDA", fullName: "Saudi Food and Drug Authority", signals: ["S"], cadence: "daily", note: "", status: "live" },
  { flag: "🇦🇪", country: "UAE", authority: "MOHAP", fullName: "Ministry of Health and Prevention", signals: ["S"], cadence: "daily", note: "", status: "live" },
  { flag: "🇿🇦", country: "South Africa", authority: "SAHPRA", fullName: "SA Health Products Regulatory Authority", signals: ["S"], cadence: "daily", note: "", status: "live" },
  { flag: "🇳🇬", country: "Nigeria", authority: "NAFDAC", fullName: "National Agency for Food and Drug Admin.", signals: ["S"], cadence: "daily", note: "", status: "live" },
  { flag: "🇸🇳", country: "Senegal", authority: "ARP", fullName: "Agence de Réglementation Pharmaceutique", signals: ["S"], cadence: "daily", note: "PDF-limited", status: "live" },
  { flag: "🇲🇽", country: "Mexico", authority: "COFEPRIS", fullName: "Federal Commission for Protection against Sanitary Risk", signals: ["S"], cadence: "daily", note: "", status: "live" },
  { flag: "🇦🇷", country: "Argentina", authority: "ANMAT", fullName: "National Administration of Drugs", signals: ["S"], cadence: "daily", note: "", status: "live" },
  { flag: "🇨🇴", country: "Colombia", authority: "INVIMA", fullName: "National Food and Drug Surveillance Institute", signals: ["S"], cadence: "daily", note: "1,619 events", status: "live" },
  { flag: "🇵🇪", country: "Peru", authority: "DIGEMID", fullName: "General Directorate of Medicines", signals: ["S"], cadence: "daily", note: "2,675 events", status: "live" },
];

const VISIBLE = 19;
const SIG_LABEL = { S: "Shortages", R: "Recalls", P: "Pricing" } as const;
const PILL_LABEL: Record<Status, string> = {
  live: "Live",
  degraded: "Degraded",
  offline: "Source offline",
  blocked: "Blocked",
};

export default function SourceRegistry() {
  const [expanded, setExpanded] = useState(false);
  const rows = expanded ? SOURCES : SOURCES.slice(0, VISIBLE);

  return (
    <div className="registry-card">
      <div className="registry-bar">
        <span className="rb-title">National shortage &amp; recall sources</span>
        <span className="rb-note mono">health checked daily</span>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Country</th>
              <th>Authority</th>
              <th>Signals</th>
              <th>Cadence</th>
              <th style={{ textAlign: "right" }}>Events</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.country}>
                <td className="c-country"><span className="flag">{s.flag}</span>{s.country}</td>
                <td className="c-auth">{s.authority}<span className="full">{s.fullName}</span></td>
                <td>{s.signals.map((k) => <span key={k} className="sig">{SIG_LABEL[k]}</span>)}</td>
                <td className="c-cad">{s.cadence}</td>
                <td className="c-rec">{s.note}</td>
                <td><span className={`pill ${s.status}`}><span className="dot" />{PILL_LABEL[s.status]}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="registry-foot">
        <div className="legend">
          <span><span className="pill live"><span className="dot" />Live</span></span>
          <span><span className="pill degraded"><span className="dot" />Degraded</span> partial coverage, disclosed</span>
          <span><span className="pill offline"><span className="dot" />Source offline</span> regulator feed discontinued</span>
          <span><span className="pill blocked"><span className="dot" />Blocked</span> source refuses automated access</span>
        </div>
        <button
          type="button"
          className="toggle-btn"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "Show fewer" : `Show all ${SOURCES.length} sources`}
        </button>
      </div>
    </div>
  );
}
