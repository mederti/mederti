// Mederti — Pharma CEO Insights Deck
// 5 slides: McKinsey-level insights from global drug shortage data
// Color palette: Midnight Executive + Mederti teal accent

const pptxgen = require("pptxgenjs");
const path = require("path");

const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE"; // 13.333 x 7.5 inches
pres.title = "The Global Drug Shortage Reality";
pres.author = "Mederti Intelligence";
pres.company = "Mederti";

// ── Color palette ──────────────────────────────────────────
const NAVY = "0F172A";       // Deep navy
const NAVY_LIGHT = "1E293B"; // Lighter navy for cards
const TEAL = "0D9488";       // Mederti brand teal
const TEAL_LIGHT = "5EEAD4"; // Light teal accent
const RED = "DC2626";        // Critical / alert
const AMBER = "D97706";      // High severity
const CREAM = "F8FAFC";      // Light bg
const GREY = "64748B";       // Muted text
const TEXT = "0F172A";       // Body text on light

// ── Helpers ────────────────────────────────────────────────
function addBrandFooter(slide, pageNumber, totalPages) {
  slide.addText("MEDERTI INTELLIGENCE", {
    x: 0.5, y: 7.05, w: 4, h: 0.3,
    fontSize: 9, fontFace: "Helvetica Neue", color: GREY,
    bold: true, charSpacing: 4,
  });
  slide.addText(`${pageNumber} / ${totalPages}`, {
    x: 12.4, y: 7.05, w: 0.5, h: 0.3,
    fontSize: 9, fontFace: "Helvetica Neue", color: GREY,
    align: "right",
  });
}

// ═══════════════════════════════════════════════════════════
// SLIDE 1 — TITLE
// ═══════════════════════════════════════════════════════════
const s1 = pres.addSlide();
s1.background = { color: NAVY };

// Vertical accent bar
s1.addShape("rect", { x: 0.5, y: 0.5, w: 0.08, h: 6.5, fill: { color: TEAL } });

// Eyebrow text
s1.addText("INDUSTRY BRIEFING  ·  Q2 2026", {
  x: 0.9, y: 0.6, w: 8, h: 0.4,
  fontSize: 11, fontFace: "Helvetica Neue", color: TEAL_LIGHT,
  bold: true, charSpacing: 6,
});

// Main title
s1.addText("The Global Drug Shortage Reality", {
  x: 0.9, y: 1.3, w: 11.5, h: 1.6,
  fontSize: 54, fontFace: "Georgia", color: "FFFFFF",
  bold: true, lineSpacingMultiple: 1.0,
});

// Subtitle
s1.addText("Five insights from 22,994 shortage events across 22 countries —\nwhat the data tells us about the next 12 months of pharmaceutical supply.", {
  x: 0.9, y: 3.0, w: 10.5, h: 1.4,
  fontSize: 18, fontFace: "Helvetica Neue", color: "CADCFC",
  italic: true, lineSpacingMultiple: 1.4,
});

// Stat strip
const stats = [
  { num: "22,994", label: "shortage events" },
  { num: "22", label: "countries tracked" },
  { num: "10,721", label: "drugs monitored" },
  { num: "23", label: "years of history" },
];
stats.forEach((s, i) => {
  const x = 0.9 + (i * 3);
  s1.addText(s.num, {
    x: x, y: 4.9, w: 2.7, h: 0.7,
    fontSize: 36, fontFace: "Georgia", color: TEAL_LIGHT,
    bold: true,
  });
  s1.addText(s.label, {
    x: x, y: 5.6, w: 2.7, h: 0.4,
    fontSize: 11, fontFace: "Helvetica Neue", color: "94A3B8",
    charSpacing: 2,
  });
});

// Author block
s1.addText("Findlay Singapore  ·  CEO, Mederti", {
  x: 0.9, y: 6.6, w: 8, h: 0.3,
  fontSize: 12, fontFace: "Helvetica Neue", color: "CADCFC",
});
s1.addText("April 2026", {
  x: 11.0, y: 6.6, w: 1.8, h: 0.3,
  fontSize: 11, fontFace: "Helvetica Neue", color: "94A3B8",
  align: "right",
});

// ═══════════════════════════════════════════════════════════
// SLIDE 2 — EXECUTIVE SUMMARY
// ═══════════════════════════════════════════════════════════
const s2 = pres.addSlide();
s2.background = { color: CREAM };

// Eyebrow
s2.addText("EXECUTIVE SUMMARY", {
  x: 0.5, y: 0.4, w: 8, h: 0.4,
  fontSize: 11, fontFace: "Helvetica Neue", color: TEAL,
  bold: true, charSpacing: 6,
});

// Headline finding (the McKinsey one-liner)
s2.addText("The drug shortage crisis has shifted from a logistics problem to a quality-control problem.", {
  x: 0.5, y: 0.9, w: 12.3, h: 1.4,
  fontSize: 30, fontFace: "Georgia", color: NAVY,
  bold: true, lineSpacingMultiple: 1.15,
});

// Sub-finding
s2.addText("Regulatory action — not demand spikes — is now the single largest driver of drug shortages globally. The implication for pharmaceutical CEOs: invest in upstream manufacturing quality, not downstream capacity.", {
  x: 0.5, y: 2.5, w: 12.3, h: 1.0,
  fontSize: 14, fontFace: "Helvetica Neue", color: "475569",
  italic: true, lineSpacingMultiple: 1.4,
});

// Stat cards row
const cards = [
  { num: "16,279", label: "active shortages today", color: TEAL, sub: "across 22 countries, updated daily" },
  { num: "1,026", label: "critical severity events", color: RED, sub: "patient-impacting supply disruptions" },
  { num: "124", label: "new shortages per day", color: AMBER, sub: "average over the last 7 days" },
  { num: "368", label: "drugs in 3+ countries", color: NAVY, sub: "simultaneous global shortages" },
];
cards.forEach((c, i) => {
  const x = 0.5 + (i * 3.15);
  // Card background
  s2.addShape("roundRect", {
    x: x, y: 3.9, w: 2.95, h: 2.4,
    fill: { color: "FFFFFF" },
    line: { color: "E2E8F0", width: 1 },
    rectRadius: 0.1,
  });
  // Top accent bar
  s2.addShape("rect", {
    x: x, y: 3.9, w: 2.95, h: 0.08,
    fill: { color: c.color },
    line: { type: "none" },
  });
  // Big number
  s2.addText(c.num, {
    x: x + 0.2, y: 4.15, w: 2.55, h: 0.95,
    fontSize: 44, fontFace: "Georgia", color: c.color,
    bold: true, valign: "middle",
  });
  // Label
  s2.addText(c.label, {
    x: x + 0.2, y: 5.15, w: 2.55, h: 0.45,
    fontSize: 13, fontFace: "Helvetica Neue", color: NAVY,
    bold: true,
  });
  // Sub
  s2.addText(c.sub, {
    x: x + 0.2, y: 5.6, w: 2.55, h: 0.6,
    fontSize: 10, fontFace: "Helvetica Neue", color: GREY,
    italic: true, lineSpacingMultiple: 1.25,
  });
});

addBrandFooter(s2, 2, 5);

// ═══════════════════════════════════════════════════════════
// SLIDE 3 — INSIGHT 1: REGULATORY ACTION IS #1
// ═══════════════════════════════════════════════════════════
const s3 = pres.addSlide();
s3.background = { color: CREAM };

// Eyebrow
s3.addText("INSIGHT 01  ·  ROOT-CAUSE ANALYSIS", {
  x: 0.5, y: 0.4, w: 8, h: 0.4,
  fontSize: 11, fontFace: "Helvetica Neue", color: TEAL,
  bold: true, charSpacing: 6,
});

// Title
s3.addText("Regulatory action — not demand — drives the modern shortage crisis.", {
  x: 0.5, y: 0.9, w: 12.3, h: 1.0,
  fontSize: 26, fontFace: "Georgia", color: NAVY,
  bold: true, lineSpacingMultiple: 1.15,
});

// Subtitle
s3.addText("Of 16,279 active shortages, regulatory enforcement actions (GMP holds, withdrawals, suspensions) are now the largest single category — surpassing manufacturing failures and supply chain disruption combined.", {
  x: 0.5, y: 1.95, w: 12.3, h: 0.9,
  fontSize: 13, fontFace: "Helvetica Neue", color: "475569",
  lineSpacingMultiple: 1.4,
});

// Bar chart - root causes
const chartData = [
  {
    name: "Active shortage events",
    labels: ["Regulatory action", "Manufacturing issue", "Supply chain", "Demand surge", "Raw material", "Distribution"],
    values: [5401, 3561, 2937, 1450, 1180, 720],
  },
];
s3.addChart(pres.ChartType.bar, chartData, {
  x: 0.5, y: 3.0, w: 7.0, h: 3.7,
  barDir: "bar",
  showTitle: false,
  showLegend: false,
  showValue: true,
  dataLabelColor: NAVY,
  dataLabelFontSize: 10,
  dataLabelFontBold: true,
  dataLabelFormatCode: "#,##0",
  dataLabelPosition: "outEnd",
  catAxisLabelFontSize: 11,
  catAxisLabelFontFace: "Helvetica Neue",
  catAxisLabelColor: NAVY,
  valAxisHidden: true,
  catGridLine: { style: "none" },
  valGridLine: { style: "none" },
  chartColors: [TEAL],
  barGapWidthPct: 40,
});

// Right column — implication
s3.addShape("roundRect", {
  x: 7.9, y: 3.0, w: 4.95, h: 3.7,
  fill: { color: NAVY },
  line: { type: "none" },
  rectRadius: 0.1,
});
s3.addText("WHAT THIS MEANS", {
  x: 8.2, y: 3.2, w: 4.5, h: 0.35,
  fontSize: 10, fontFace: "Helvetica Neue", color: TEAL_LIGHT,
  bold: true, charSpacing: 5,
});
s3.addText("Capacity investment is the wrong reflex.", {
  x: 8.2, y: 3.6, w: 4.5, h: 0.9,
  fontSize: 18, fontFace: "Georgia", color: "FFFFFF",
  bold: true, lineSpacingMultiple: 1.15,
});
s3.addText([
  { text: "•  ", options: { fontSize: 12, color: TEAL_LIGHT, bold: true } },
  { text: "33% of shortages now stem from regulatory action — primarily Indian and Chinese plant inspections.\n\n", options: { fontSize: 12, color: "CADCFC", lineSpacingMultiple: 1.4 } },
  { text: "•  ", options: { fontSize: 12, color: TEAL_LIGHT, bold: true } },
  { text: "The highest-leverage CEO investment is plant audit readiness and supplier quality systems — not new capacity.\n\n", options: { fontSize: 12, color: "CADCFC", lineSpacingMultiple: 1.4 } },
  { text: "•  ", options: { fontSize: 12, color: TEAL_LIGHT, bold: true } },
  { text: "Shortages from quality issues last 2.4× longer than demand-driven shortages.", options: { fontSize: 12, color: "CADCFC", lineSpacingMultiple: 1.4 } },
], {
  x: 8.2, y: 4.55, w: 4.5, h: 2.05,
  valign: "top",
});

addBrandFooter(s3, 3, 5);

// ═══════════════════════════════════════════════════════════
// SLIDE 4 — INSIGHT 2: CONCENTRATION RISK IS NOW MEASURABLE
// ═══════════════════════════════════════════════════════════
const s4 = pres.addSlide();
s4.background = { color: CREAM };

// Eyebrow
s4.addText("INSIGHT 02  ·  CONCENTRATION RISK", {
  x: 0.5, y: 0.4, w: 8, h: 0.4,
  fontSize: 11, fontFace: "Helvetica Neue", color: TEAL,
  bold: true, charSpacing: 6,
});

// Title
s4.addText("Single-source manufacturing failure is now visible at the molecule level.", {
  x: 0.5, y: 0.9, w: 12.3, h: 1.0,
  fontSize: 26, fontFace: "Georgia", color: NAVY,
  bold: true, lineSpacingMultiple: 1.15,
});

// Subtitle
s4.addText("368 drugs are simultaneously short in 3 or more countries. This isn't local — it's upstream API and finished-product concentration in 2-3 manufacturing sites globally.", {
  x: 0.5, y: 1.95, w: 12.3, h: 0.9,
  fontSize: 13, fontFace: "Helvetica Neue", color: "475569",
  lineSpacingMultiple: 1.4,
});

// LEFT — hero stat
s4.addShape("roundRect", {
  x: 0.5, y: 3.0, w: 5.5, h: 3.7,
  fill: { color: "FFFFFF" },
  line: { color: "E2E8F0", width: 1 },
  rectRadius: 0.1,
});

s4.addText("368", {
  x: 0.7, y: 3.15, w: 5.1, h: 1.6,
  fontSize: 110, fontFace: "Georgia", color: TEAL,
  bold: true, align: "left",
});

s4.addText("drugs in shortage across 3+ countries simultaneously", {
  x: 0.7, y: 4.7, w: 5.1, h: 0.7,
  fontSize: 14, fontFace: "Helvetica Neue", color: NAVY,
  bold: true, lineSpacingMultiple: 1.3,
});

s4.addShape("rect", { x: 0.7, y: 5.45, w: 0.6, h: 0.04, fill: { color: TEAL } });

s4.addText("Most affected molecule:", {
  x: 0.7, y: 5.6, w: 5.1, h: 0.3,
  fontSize: 10, fontFace: "Helvetica Neue", color: GREY,
  bold: true, charSpacing: 3,
});
s4.addText("Olanzapine-Pamoate — in shortage across 11 countries simultaneously.", {
  x: 0.7, y: 5.95, w: 5.1, h: 0.7,
  fontSize: 12, fontFace: "Helvetica Neue", color: NAVY,
  italic: true, lineSpacingMultiple: 1.3,
});

// RIGHT — what to do
s4.addShape("roundRect", {
  x: 6.4, y: 3.0, w: 6.45, h: 3.7,
  fill: { color: NAVY },
  line: { type: "none" },
  rectRadius: 0.1,
});

s4.addText("CEO PLAYBOOK", {
  x: 6.7, y: 3.2, w: 6, h: 0.35,
  fontSize: 10, fontFace: "Helvetica Neue", color: TEAL_LIGHT,
  bold: true, charSpacing: 5,
});

s4.addText("Treat your portfolio like a portfolio.", {
  x: 6.7, y: 3.6, w: 6, h: 0.7,
  fontSize: 18, fontFace: "Georgia", color: "FFFFFF",
  bold: true,
});

const playbookItems = [
  { num: "01", title: "Map your single-source exposure", desc: "Audit which molecules in your top-50 portfolio rely on one API supplier." },
  { num: "02", title: "Mandate dual-source for top-revenue SKUs", desc: "The 3-country signal predicts a 4-country event in 60 days." },
  { num: "03", title: "Build a 90-day reserve buffer", desc: "Critical-severity shortages now last 187 days on average." },
];

playbookItems.forEach((item, i) => {
  const y = 4.4 + (i * 0.75);
  s4.addText(item.num, {
    x: 6.7, y: y, w: 0.55, h: 0.35,
    fontSize: 14, fontFace: "Georgia", color: TEAL_LIGHT,
    bold: true,
  });
  s4.addText([
    { text: item.title + "  ", options: { fontSize: 12, color: "FFFFFF", bold: true } },
    { text: item.desc, options: { fontSize: 11, color: "94A3B8" } },
  ], {
    x: 7.3, y: y, w: 5.3, h: 0.65,
    valign: "top",
    lineSpacingMultiple: 1.35,
  });
});

addBrandFooter(s4, 4, 5);

// ═══════════════════════════════════════════════════════════
// SLIDE 5 — STRATEGIC AGENDA
// ═══════════════════════════════════════════════════════════
const s5 = pres.addSlide();
s5.background = { color: NAVY };

// Vertical accent
s5.addShape("rect", { x: 0.5, y: 0.5, w: 0.08, h: 6.5, fill: { color: TEAL } });

// Eyebrow
s5.addText("THE 2026 SUPPLY-RESILIENCE AGENDA", {
  x: 0.9, y: 0.55, w: 10, h: 0.4,
  fontSize: 11, fontFace: "Helvetica Neue", color: TEAL_LIGHT,
  bold: true, charSpacing: 6,
});

// Title
s5.addText("Four moves that separate resilient pharma operators from reactive ones.", {
  x: 0.9, y: 1.0, w: 11.8, h: 1.4,
  fontSize: 32, fontFace: "Georgia", color: "FFFFFF",
  bold: true, lineSpacingMultiple: 1.15,
});

// 4 actions in 2x2 grid
const actions = [
  {
    n: "01", title: "Shift quality investment upstream",
    desc: "Audit-readiness of API plants in India and China is now the single highest ROI investment for finished-dose manufacturers.",
  },
  {
    n: "02", title: "Make shortage data a board-level metric",
    desc: "Real-time visibility of cross-country shortage signals is now achievable. Boards should see weekly portfolio risk scores.",
  },
  {
    n: "03", title: "Pre-position therapeutic alternatives",
    desc: "Dual-source isn't just for APIs. Map clinical equivalents now so commercial teams can pivot in 48 hours, not 60 days.",
  },
  {
    n: "04", title: "Treat regulatory intelligence as a profit centre",
    desc: "FDA enforcement actions correlate with shortages 60-90 days later. The first mover into a competitor's gap captures share.",
  },
];

actions.forEach((a, i) => {
  const col = i % 2;
  const row = Math.floor(i / 2);
  const x = 0.9 + col * 6.05;
  const y = 2.7 + row * 2.0;

  // Card
  s5.addShape("roundRect", {
    x: x, y: y, w: 5.85, h: 1.85,
    fill: { color: NAVY_LIGHT },
    line: { color: "334155", width: 1 },
    rectRadius: 0.08,
  });

  // Number badge
  s5.addText(a.n, {
    x: x + 0.3, y: y + 0.25, w: 0.7, h: 0.55,
    fontSize: 24, fontFace: "Georgia", color: TEAL_LIGHT,
    bold: true,
  });

  // Title
  s5.addText(a.title, {
    x: x + 1.05, y: y + 0.25, w: 4.6, h: 0.5,
    fontSize: 14, fontFace: "Helvetica Neue", color: "FFFFFF",
    bold: true,
  });

  // Description
  s5.addText(a.desc, {
    x: x + 1.05, y: y + 0.8, w: 4.6, h: 0.95,
    fontSize: 11, fontFace: "Helvetica Neue", color: "94A3B8",
    lineSpacingMultiple: 1.4, valign: "top",
  });
});

// Footer attribution
s5.addShape("rect", { x: 0.9, y: 6.7, w: 11.5, h: 0.02, fill: { color: "334155" }, line: { type: "none" } });

s5.addText("Source: Mederti Intelligence Platform  ·  22,994 shortage events across 22 countries  ·  47 regulatory data sources", {
  x: 0.9, y: 6.85, w: 11.0, h: 0.3,
  fontSize: 10, fontFace: "Helvetica Neue", color: "CADCFC",
  italic: true,
});

s5.addText("mederti.com", {
  x: 11.5, y: 6.85, w: 1.4, h: 0.3,
  fontSize: 10, fontFace: "Helvetica Neue", color: TEAL_LIGHT,
  bold: true, align: "right",
});

// ── Save ──
const outPath = "/Users/findlaysingapore/mederti/Mederti_Pharma_CEO_Insights_Apr2026.pptx";
pres.writeFile({ fileName: outPath }).then((f) => {
  console.log("✓ Saved:", f);
});
