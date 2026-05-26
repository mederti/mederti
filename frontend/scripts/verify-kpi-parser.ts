// Parser smoke test: exercises the new <kpis>...</kpis> tag plus the existing
// drug_card / followups / alternates handling against a realistic Mode C
// response. Run with: cd frontend && npx tsx scripts/verify-kpi-parser.ts

import { parseAgentResponse } from "../app/chat/components/parser";

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
  console.log("ok  :", msg);
}

// Simulated Mode C landscape response.
const realistic = `<kpis>7:Critical antibacterial shortages|3:Drugs affected|2:Countries|3/3:WHO essential medicines hit</kpis>

Vancomycin, Azithromycin and Ciprofloxacin are tagged critical in AU and US — all three are on the WHO Essential Medicines list. The 91 active antibacterial shortages globally trace back to a 28% concentration in piperacillin/tazobactam alone (Sandoz Nov 2025 report).

<drug_card id="11111111-2222-3333-4444-555555555555" />

<drug_card id="22222222-3333-4444-5555-666666666666" />

The structural driver hasn't changed since the 2022-23 winter crisis: low-margin generics + single-API sourcing + minimal redundancy (Reuters, 14 May).

<followups>Show oncology landscape|Drill into Vancomycin supply|EU Critical Medicines Alliance update</followups>`;

const parts = parseAgentResponse(realistic);
console.log(`\nparsed ${parts.length} parts:`);
for (const p of parts) {
  if (p.kind === "text") console.log(`  text(${p.text.replace(/\n/g, "↵").slice(0, 60)}...)`);
  else if (p.kind === "drug") console.log(`  drug(${p.id})`);
  else if (p.kind === "kpis") console.log(`  kpis(${p.items.map(t => `${t.value}=${t.label}`).join(" | ")})`);
  else if (p.kind === "followups") console.log(`  followups(${p.items.join(" | ")})`);
  else console.log(`  ${p.kind}(...)`);
}

const kpis = parts.find((p): p is Extract<typeof parts[number], { kind: "kpis" }> => p.kind === "kpis");
assert(!!kpis, "<kpis> tag is parsed into a part");
assert(kpis!.items.length === 4, "4 KPI tiles parsed");
assert(kpis!.items[0].value === "7" && kpis!.items[0].label === "Critical antibacterial shortages", "first KPI value+label correct");
assert(kpis!.items[3].value === "3/3" && kpis!.items[3].label === "WHO essential medicines hit", "value can contain '/'");

const drugs = parts.filter((p) => p.kind === "drug");
assert(drugs.length === 2, "both drug_cards parsed");

const fups = parts.find((p): p is Extract<typeof parts[number], { kind: "followups" }> => p.kind === "followups");
assert(!!fups && fups.items.length === 3, "followups parsed with 3 items");

// Truncated mid-tag case — the chat route's tool budget can chop the closing tag.
const truncated = `<kpis>91:Active shortages|11:Countries`;
const tp = parseAgentResponse(truncated);
const kpisT = tp.find((p): p is Extract<typeof tp[number], { kind: "kpis" }> => p.kind === "kpis");
assert(!!kpisT, "unclosed trailing <kpis> is still parsed (tolerant fallback)");
assert(kpisT!.items.length === 2, "2 KPIs recovered from truncated tag");

// Edge: closed <kpis>...</kpis> followed by text — text must NOT be absorbed.
const closedThenText = `<kpis>10:A|20:B</kpis>\n\nmore stuff`;
const ct = parseAgentResponse(closedThenText);
const textPart = ct.find((p) => p.kind === "text");
assert(!!textPart, "text after closed <kpis> survives");

// <sources>...</sources> regulator chips — the heart of the verifiability story.
const withSources = `Vancomycin in shortage.

<drug_card id="11111111-2222-3333-4444-555555555555" />

<sources>TGA:AU:812:scraped today:https://www.tga.gov.au/resources/resource/shortages|AIFA:IT:54:scraped 6h ago|Health Canada:CA:22:scraped 4h ago|FDA:US:12:scraped 18h ago</sources>

<followups>A|B|C</followups>`;
const ws = parseAgentResponse(withSources);
const sources = ws.find((p): p is Extract<typeof ws[number], { kind: "sources" }> => p.kind === "sources");
assert(!!sources, "<sources> tag parsed");
assert(sources!.items.length === 4, "4 source chips parsed");
assert(sources!.items[0].code === "TGA" && sources!.items[0].country === "AU", "first chip code+country");
assert(sources!.items[0].rows === 812, "first chip row count parsed as number");
assert(sources!.items[0].freshness === "scraped today", "first chip freshness");
assert(sources!.items[0].url === "https://www.tga.gov.au/resources/resource/shortages", "first chip URL extracted");
assert(sources!.items[1].url === undefined, "chip without URL leaves url undefined");
assert(sources!.items[2].code === "Health Canada", "multi-word code allowed");

// Truncated mid-tag — the model might cut off mid-URL.
const truncSources = `<sources>TGA:AU:812:scraped today|AIFA:IT:54`;
const tsParts = parseAgentResponse(truncSources);
const tsSrc = tsParts.find((p): p is Extract<typeof tsParts[number], { kind: "sources" }> => p.kind === "sources");
assert(!!tsSrc, "unclosed <sources> still parsed via tolerant fallback");
assert(tsSrc!.items.length === 2, "2 chips recovered from truncated <sources>");

console.log("\nALL OK");
