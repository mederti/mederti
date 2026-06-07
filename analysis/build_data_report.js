const fs = require("fs");
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, LevelFormat, HeadingLevel, BorderStyle, WidthType,
  ShadingType, PageNumber, Header, Footer, TableOfContents, PageBreak,
  TabStopType, TabStopPosition,
} = require("docx");

const INK = "12211B";       // near-black green-ink
const GREEN = "1F6F4A";     // brand green
const LIGHT = "E6F0EA";     // header fill
const ZEBRA = "F4F8F6";
const GREY = "5B6660";

const CW = 9360; // content width, US Letter, 1" margins

const border = { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" };
const borders = { top: border, bottom: border, left: border, right: border };
const cellMargins = { top: 60, bottom: 60, left: 120, right: 120 };

function tc(text, w, { head = false, bold = false, fill, align } = {}) {
  return new TableCell({
    borders,
    width: { size: w, type: WidthType.DXA },
    margins: cellMargins,
    shading: fill ? { fill, type: ShadingType.CLEAR } : undefined,
    children: [new Paragraph({
      alignment: align || AlignmentType.LEFT,
      children: [new TextRun({ text: String(text), bold: head || bold, color: head ? INK : INK, size: head ? 19 : 19 })],
    })],
  });
}

function table(headers, rows, widths) {
  const headRow = new TableRow({
    tableHeader: true,
    children: headers.map((h, i) => tc(h, widths[i], { head: true, fill: LIGHT, align: i === 0 ? AlignmentType.LEFT : AlignmentType.LEFT })),
  });
  const bodyRows = rows.map((r, ri) =>
    new TableRow({
      children: r.map((cell, i) => tc(cell, widths[i], { fill: ri % 2 ? ZEBRA : undefined })),
    })
  );
  return new Table({
    width: { size: CW, type: WidthType.DXA },
    columnWidths: widths,
    rows: [headRow, ...bodyRows],
  });
}

const H1 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(t)] });
const H2 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(t)] });
const P = (runs, opts = {}) => new Paragraph({ spacing: { after: 120 }, ...opts, children: Array.isArray(runs) ? runs : [new TextRun(runs)] });
const bullet = (text, level = 0) => new Paragraph({ numbering: { reference: "bul", level }, spacing: { after: 60 }, children: typeof text === "string" ? [new TextRun(text)] : text });
const r = (t, o = {}) => new TextRun({ text: t, ...o });
const caption = (t) => new Paragraph({ spacing: { before: 40, after: 200 }, children: [new TextRun({ text: t, italics: true, size: 17, color: GREY })] });

const doc = new Document({
  creator: "Mederti",
  title: "Mederti Data Asset Inventory",
  styles: {
    default: { document: { run: { font: "Arial", size: 21, color: INK } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 30, bold: true, font: "Arial", color: GREEN },
        paragraph: { spacing: { before: 320, after: 160 }, outlineLevel: 0,
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: GREEN, space: 4 } } } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 24, bold: true, font: "Arial", color: INK },
        paragraph: { spacing: { before: 220, after: 100 }, outlineLevel: 1 } },
    ],
  },
  numbering: {
    config: [{
      reference: "bul",
      levels: [
        { level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 460, hanging: 260 } } } },
        { level: 1, format: LevelFormat.BULLET, text: "–", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 920, hanging: 260 } } } },
      ],
    }],
  },
  sections: [{
    properties: {
      page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } },
    },
    headers: {
      default: new Header({ children: [new Paragraph({
        tabStops: [{ type: TabStopType.RIGHT, position: 9360 }],
        border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: "DDDDDD", space: 6 } },
        children: [r("MEDERTI", { bold: true, color: GREEN, size: 16 }), r("\tData Asset Inventory — Confidential", { color: GREY, size: 16 })],
      })] }),
    },
    footers: {
      default: new Footer({ children: [new Paragraph({
        tabStops: [{ type: TabStopType.RIGHT, position: 9360 }],
        children: [r("Generated 3 June 2026 · figures are live production counts", { color: GREY, size: 16 }), r("\tPage ", { color: GREY, size: 16 }), new TextRun({ children: [PageNumber.CURRENT], color: GREY, size: 16 })],
      })] }),
    },
    children: [
      // ---- Title block ----
      new Paragraph({ spacing: { before: 1600, after: 0 }, children: [r("Mederti", { bold: true, size: 56, color: GREEN })] }),
      new Paragraph({ spacing: { after: 60 }, children: [r("Data Asset Inventory", { bold: true, size: 40, color: INK })] }),
      new Paragraph({ spacing: { after: 360 }, children: [r("What we hold today — a reference for source mapping", { size: 24, color: GREY })] }),
      new Paragraph({ border: { top: { style: BorderStyle.SINGLE, size: 6, color: GREEN, space: 6 } }, spacing: { before: 120, after: 120 }, children: [] }),
      P([r("Prepared for: ", { bold: true }), r("Chief Data Officer")]),
      P([r("Purpose: ", { bold: true }), r("Inventory of live, in-production data assets and sources to inform forward source-mapping and prioritisation.")]),
      P([r("Scope note: ", { bold: true }), r("All counts in this document are live production figures queried on 3 June 2026. Built-but-unshipped scrapers and pending migrations are excluded from headline numbers and instead flagged explicitly in "), r("Section 9 (Coverage Gaps)", { italics: true }), r(".")]),

      new Paragraph({ children: [new PageBreak()] }),
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Contents")] }),
      new TableOfContents("Contents", { hyperlink: true, headingStyleRange: "1-2" }),

      // ---- 1. Executive summary ----
      new Paragraph({ pageBreakBefore: true, heading: HeadingLevel.HEADING_1, children: [new TextRun("1. Executive Summary")] }),
      P("Mederti operates a continuously-refreshed database of global drug-shortage and recall intelligence, enriched with pharmaceutical reference data and a supply-side concentration layer. The platform ingests from official regulators across 20+ jurisdictions on a daily cron, normalises everything to canonical drug identities, and layers causal and macro-signal context on top."),
      P("At a glance, the live database holds:"),
      table(
        ["Asset", "Live count", "What it is"],
        [
          ["Shortage events", "37,065", "Structured shortage records (28,418 active) across 20+ countries"],
          ["Recall records", "24,293", "Product recalls/withdrawals, 99% linked to a canonical drug"],
          ["Recall–shortage links", "78,897", "Causal links between recalls and downstream shortages"],
          ["Canonical drugs", "17,835", "Deduplicated molecule/product master"],
          ["Brand / product catalogue", "160,977", "Brand & pack-level records rolled up to canonical drugs"],
          ["API suppliers", "14,009", "Active-ingredient manufacturer/site signal (FDA DMF + WHO PQ)"],
          ["Macro signal sources", "134", "Catalogued early-warning / macro / logistics feeds"],
          ["Registered data sources", "57", "Regulator & reference feeds (41 currently active)"],
        ],
        [2600, 1500, 5260]
      ),
      caption("Table 1. Headline live data volumes (production, 3 June 2026)."),
      P([r("The three structural strengths a CDO should note: ", {}),]),
      bullet([r("Breadth of regulator coverage ", { bold: true }), r("— daily ingestion from the major shortage-reporting agencies (FDA, EMA, TGA, MHRA, Health Canada, Swissmedic, PMDA, plus ~15 EU national agencies).")]),
      bullet([r("Identity resolution ", { bold: true }), r("— 160,977 brand/pack records collapse to 17,835 canonical drugs, so a search for a brand rolls up to molecule-level shortage truth.")]),
      bullet([r("Causal + supply context ", { bold: true }), r("— recall→shortage links and a 14k-row API-supplier concentration layer turn raw events into forward signal, not just a feed.")]),

      // ---- 2. Data domains ----
      H1("2. Data Domains"),
      P("The schema (49 migrations) organises into six domains. Counts are live."),
      table(
        ["Domain", "Core tables", "Live rows", "Status"],
        [
          ["Shortage core", "shortage_events, shortage_status_log, live_status_layer", "37,065 events / 56,500 status logs", "Mature"],
          ["Recall core", "recalls, recall_shortage_links", "24,293 / 78,897 links", "Mature"],
          ["Drug intelligence", "drugs, drug_catalogue, drug_synonyms, atc_codes, drug_rxnorm, drug_external_ids", "17,835 / 160,977 / 318", "Mature"],
          ["Supply intelligence", "api_suppliers, manufacturers, supplier_inventory, supply_intelligence_layer", "14,009 / 5 / 28", "API layer strong; finished-dose thin"],
          ["Macro / content", "intelligence_sources, intelligence_articles, ai_insights_cache", "134 catalogued sources", "Catalogue mature; articles building"],
          ["Ops & audit", "data_sources, raw_scrapes, audit_logs", "57 / 2,556 / —", "Operational"],
        ],
        [1900, 3400, 2360, 1700]
      ),
      caption("Table 2. Data domains and live volumes."),

      // ---- 3. Source inventory: regulators ----
      H1("3. Source Inventory — Regulatory Feeds"),
      P("Shortage and recall data is sourced exclusively from official national/supranational regulators, ingested daily on a staggered cron (19:00–07:00 UTC). Each source dedupes via an MD5 shortage key, so repeated runs are idempotent. The table below lists the regulator feeds that are live and producing data today."),
      H2("3.1 Shortage feeds (live, daily)"),
      table(
        ["Region", "Agencies live in production"],
        [
          ["North America", "FDA (US), Health Canada (CA)"],
          ["UK & Ireland", "MHRA (UK), HPRA (IE)"],
          ["EU — supranational", "EMA"],
          ["EU — national", "BfArM (DE), ANSM (FR), AIFA (IT), AEMPS (ES), CBG-MEB (NL), DKMA (DK), FIMEA (FI), Läkemedelsverket (SE), SUKL (CZ), OGYEI (HU), Swissmedic (CH), NoMA (NO), AGES (AT)"],
          ["EU — newer", "Greece (EOF), Portugal (INFARMED), Belgium (FAMHP), Poland (MZ)"],
          ["Asia-Pacific", "TGA (AU), HSA (SG), Medsafe + PHARMAC (NZ), PMDA (JP), MFDS (KR), Malaysia (NPRA)"],
          ["Latin America", "ANVISA (BR), COFEPRIS (MX), Argentina (ANMAT)"],
          ["Africa & Middle East", "SAHPRA (ZA), NAFDAC (NG), SFDA (SA), UAE (MOHAP)"],
        ],
        [2100, 7260]
      ),
      caption("Table 3. Regulatory shortage feeds wired into the daily cron."),
      H2("3.2 Recall feeds (live, daily)"),
      P("Recall ingestion runs on the same cadence: TGA, FDA (enforcement + MedWatch + Drugs@FDA), Health Canada, EMA, MHRA, AIFA, ANSM, AEMPS, HSA, Medsafe. A dedicated recall_linker populates the 78,897 recall→shortage causal links."),

      // ---- 4. Geographic coverage ----
      H1("4. Geographic Coverage — Shortages"),
      P("Live shortage-event counts by reporting country. This is the depth dimension a CDO weighs against breadth when prioritising new sources."),
      table(
        ["Country", "Events", "Country", "Events"],
        [
          ["Switzerland", "5,930", "Norway", "973"],
          ["Japan", "5,672", "Ireland", "778"],
          ["United States", "4,469", "Germany", "740"],
          ["Italy", "4,422", "France", "575"],
          ["Canada", "3,233", "Greece", "440"],
          ["Spain", "3,172", "Singapore", "321"],
          ["Finland", "1,815", "New Zealand", "290"],
          ["Australia", "1,707", "Malaysia", "226"],
          ["Belgium", "1,014", "United Kingdom", "80"],
          ["Netherlands", "1,010", "Portugal / UAE / Slovakia", "64 / 20 / 13"],
        ],
        [2900, 1780, 2900, 1780]
      ),
      caption("Table 4. Live shortage events by reporting country (top jurisdictions)."),
      P([r("Status mix across all events: ", {}), r("28,418 active", { bold: true }), r(", 6,439 resolved, 2,204 anticipated. "), r("1,589", { bold: true }), r(" events are flagged "), r("synthetic", { italics: true }), r(" (recall-derived signal, not a primary regulator notice) and are kept distinct so they never inflate the genuine shortage picture.")]),

      H1("5. Geographic Coverage — Recalls"),
      table(
        ["Jurisdiction", "Recalls", "Jurisdiction", "Recalls"],
        [
          ["United States", "17,689", "United Kingdom", "391"],
          ["Canada", "4,597", "EU (EMA)", "369"],
          ["Italy", "460", "New Zealand", "186"],
          ["Australia", "390", "France", "171"],
          ["", "", "Spain", "40"],
        ],
        [2900, 1780, 2900, 1780]
      ),
      caption("Table 5. Live recall records by jurisdiction. 24,133 of 24,293 (99%) are linked to a canonical drug."),

      // ---- 6. Reference / enrichment ----
      H1("6. Reference & Enrichment Layer"),
      P("Raw regulator notices are normalised and enriched against authoritative pharmaceutical reference datasets, loaded by 16 importers. This layer is what lets a brand name, a salt form, or an accented INN all resolve to one molecule."),
      table(
        ["Reference set", "Role"],
        [
          ["WHO ATC / DDD", "Therapeutic classification + defined daily dose"],
          ["RxNorm (NLM)", "US clinical drug nomenclature & ingredient mapping"],
          ["UNII (FDA)", "Unique ingredient identifiers for salt-form resolution"],
          ["SNOMED CT", "Clinical terminology cross-walk"],
          ["EMA EPAR", "European authorisation metadata"],
          ["OECD pharma", "Macro pharmaceutical market reference"],
          ["PharmaCompass", "Supplier / API market reference"],
          ["INN resolution + substance resolver", "Salt-stripping & molecule identity (brand→generic rollup)"],
        ],
        [2900, 6460]
      ),
      caption("Table 6. Reference datasets feeding identity resolution and enrichment."),

      // ---- 7. Supply-side ----
      H1("7. Supply-Side Concentration Layer"),
      P([r("The "), r("api_suppliers", { bold: true, font: "Courier New" }), r(" table (14,009 rows) is Mederti’s answer to the single most predictive shortage driver: active-ingredient supply concentration. It is built from the FDA Drug Master File, enriched with DECRS country-of-manufacture data, and badged against the WHO Prequalification list. It replicates and extends the signal behind the Johns Hopkins API-concentration dashboard.")]),
      P("An indicative country distribution (sampled) shows the concentration risk plainly — the active-ingredient base skews heavily to a small number of origins, which is exactly the vulnerability a forward model needs:"),
      bullet("China dominates the sampled API-supplier base, with Canada, Austria, Belgium, Argentina and Brazil forming a long tail."),
      bullet([r("Refreshed "), r("quarterly", { bold: true }), r(" (Jan/Apr/Jul/Oct), alongside FDA DECRS and WHO PQ.")]),
      P([r("Finished-dose manufacturer mastering ("), r("manufacturers", { font: "Courier New" }), r(", 5 rows) and the supplier marketplace ("), r("supplier_inventory", { font: "Courier New" }), r(", 28 rows) are early-stage by comparison — noted as a gap in Section 9.")]),

      // ---- 8. Macro intelligence catalogue ----
      H1("8. Macro Intelligence Catalogue"),
      P("Beyond primary regulator data, Mederti maintains a curated catalogue of 134 macro and early-warning sources, classified by signal type. This is the catalogue most directly relevant to forward source-mapping — it already encodes a view of where leading indicators live."),
      table(
        ["Signal category", "Sources", "Signal category", "Sources"],
        [
          ["Availability ground-truth", "20", "Pipeline", "7"],
          ["Logistics", "15", "Data portals / discovery", "7"],
          ["Macro", "12", "Sanctions", "6"],
          ["Procurement", "11", "Trade", "5"],
          ["Early warning", "10", "Utilization", "5"],
          ["External shocks", "9", "Corporate disclosure", "5"],
          ["Reference data", "8", "Public health", "4"],
          ["Pricing", "8", "Funding & aid flows", "2"],
        ],
        [3300, 1380, 3300, 1380]
      ),
      caption("Table 7. The 134-source macro catalogue by signal category."),
      P("Source-priority guidance is encoded throughout: regulators rank above journals, above specialist trade press, above investigative and national press. This tiering is the scaffolding any new source should be slotted into."),

      // ---- 9. Coverage gaps ----
      H1("9. Coverage Gaps — Whitespace for Source Mapping"),
      P("The most actionable section for forward planning. These are dimensions where the platform is thin or absent today — candidate priorities for the CDO’s source map. All statements reflect live production state."),
      H2("9.1 Built but not yet producing data"),
      P("Scraper code exists for these major markets but they return zero live rows — the fastest coverage wins, since the engineering is largely done:"),
      bullet("China (NMPA), India (CDSCO), Israel (MOH), Turkey (TITCK) — high market-size / geopolitical relevance."),
      bullet("Several recall counterparts (BfArM, HSA, Medsafe recalls) exist as files awaiting wiring."),
      H2("9.2 Empty or thin data dimensions"),
      table(
        ["Dimension", "Live state", "Implication"],
        [
          ["Drug pricing", "0 rows", "No price/tender signal — a whole forward axis is unpopulated"],
          ["Demand / utilization", "Schema present, sparse", "Demand-spike precursors not yet captured"],
          ["Finished-dose manufacturers", "5 rows", "Maker signal exists for APIs (14k) but not finished product"],
          ["Supplier marketplace", "28 rows", "Two-sided marketplace data is nascent"],
        ],
        [2600, 2400, 4360]
      ),
      caption("Table 8. Thin / empty dimensions and what they cost the forward model."),
      H2("9.3 Operational / trust gaps"),
      bullet([r("Source freshness", { bold: true }), r(" — last_scraped_at is only partially wired, so there is no per-source freshness signal exposed to users yet.")]),
      bullet([r("Scraper hosting", { bold: true }), r(" — ingestion still runs partly on local cron; a laptop-sleep is a data-gap risk until the Railway migration completes.")]),
      bullet([r("No public methodology / freshness dashboard", { bold: true }), r(" — a credibility lever for institutional citation.")]),

      // ---- 10. Lineage & quality ----
      H1("10. Data Lineage & Quality Controls"),
      bullet([r("Raw capture", { bold: true }), r(" — every scrape is retained in "), r("raw_scrapes", { font: "Courier New" }), r(" (2,556 rows) for replay/audit.")]),
      bullet([r("Idempotent ingestion", { bold: true }), r(" — MD5 shortage keys mean re-runs never duplicate events.")]),
      bullet([r("Identity resolution", { bold: true }), r(" — 98% of shortage events and 99% of recalls resolve to a canonical drug.")]),
      bullet([r("Status history", { bold: true }), r(" — 56,500 status-log rows preserve the full lifecycle of each shortage (active → anticipated → resolved).")]),
      bullet([r("Synthetic flagging", { bold: true }), r(" — recall-derived signals are tagged so they never contaminate genuine regulator counts.")]),
      bullet([r("Security", { bold: true }), r(" — row-level security enabled; anonymous bulk-read access revoked; immutable audit log on mutations.")]),

      // ---- Closing ----
      H1("11. Recommended Reading Order for Source Mapping"),
      P("Suggested sequence when overlaying a future-source map on this inventory:"),
      new Paragraph({ numbering: { reference: "bul", level: 0 }, children: [r("Start with Section 9.1 — the built-but-dark markets are the cheapest coverage gains.", {})] }),
      new Paragraph({ numbering: { reference: "bul", level: 0 }, children: [r("Then Section 9.2 — pricing and demand are the two missing forward axes most likely to lift predictive power.", {})] }),
      new Paragraph({ numbering: { reference: "bul", level: 0 }, children: [r("Cross-reference any candidate against the Section 8 tiering before adding it, to keep source provenance consistent.", {})] }),
      P([r("All figures in this document can be regenerated on demand from the live database; the query set used is reproducible. ", { italics: true, color: GREY })]),
    ],
  }],
});

Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync("analysis/Mederti_Data_Asset_Inventory.docx", buf);
  console.log("written", buf.length, "bytes");
});
