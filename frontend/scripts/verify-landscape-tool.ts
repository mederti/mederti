// Standalone verification of the summarize_shortage_landscape tool.
// Bypasses the LLM and chat route — just confirms the tool returns useful
// aggregates against live Supabase data.
//
// Usage:
//   cd frontend && npx tsx scripts/verify-landscape-tool.ts

import "dotenv/config";
import { executeTool, newContext } from "../lib/chat/tools";

async function main() {
  // Sanity: env should have SUPABASE_URL + SERVICE_ROLE_KEY (or NEXT_PUBLIC_*).
  const hasUrl = !!(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL);
  const hasKey = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
  console.log(`env: SUPABASE_URL=${hasUrl} SERVICE_ROLE_KEY=${hasKey}`);
  if (!hasUrl || !hasKey) {
    console.error("Missing Supabase env. Source .env first or add to .env.local.");
    process.exit(1);
  }

  console.log("\n=== Case 1: critical antibacterials globally (the screenshot query) ===");
  const ctx1 = newContext();
  const r1: any = await executeTool(
    "summarize_shortage_landscape",
    { atc_prefix: "J01", severity: "critical" },
    ctx1
  );
  console.log("filter:", r1.filter);
  console.log("total_active_events:", r1.total_active_events);
  console.log("unique_drugs_affected:", r1.unique_drugs_affected);
  console.log("by_severity:", r1.by_severity);
  console.log("by_country (top 5):", r1.by_country.slice(0, 5));
  console.log("who_essential_overlap:", r1.who_essential_overlap);
  console.log("eu_critical_overlap:", r1.eu_critical_overlap);
  console.log("top_drugs (first 5):");
  for (const d of r1.top_drugs.slice(0, 5)) {
    console.log(
      `  - ${d.name.padEnd(28)} ${d.atc_code || "?"}  ${d.country_count} countries  ${d.shortage_event_count} events  WHO=${d.who_essential}`
    );
  }
  console.log("notes:", r1.notes);
  console.log("ctx.drugs hydrated:", Object.keys(ctx1.drugs).length);

  console.log("\n=== Case 2: oncology (L01) landscape, no severity filter ===");
  const ctx2 = newContext();
  const r2: any = await executeTool(
    "summarize_shortage_landscape",
    { atc_prefix: "L01" },
    ctx2
  );
  console.log(
    `total=${r2.total_active_events} drugs=${r2.unique_drugs_affected} severity=${JSON.stringify(r2.by_severity)}`
  );
  console.log("top 5 drugs:");
  for (const d of r2.top_drugs.slice(0, 5)) {
    console.log(`  - ${d.name.padEnd(28)} ${d.country_count} countries`);
  }

  console.log("\n=== Case 3: AU-only ===");
  const ctx3 = newContext();
  const r3: any = await executeTool(
    "summarize_shortage_landscape",
    { country: "AU", top_n: 5 },
    ctx3
  );
  console.log(`total=${r3.total_active_events} drugs=${r3.unique_drugs_affected}`);
  console.log("top:");
  for (const d of r3.top_drugs) {
    console.log(`  - ${d.name.padEnd(28)} ${d.shortage_event_count} events`);
  }

  console.log("\n=== Case 4: list_active_shortages severity fallback ===");
  const ctx4 = newContext();
  const r4: any = await executeTool(
    "list_active_shortages",
    { atc_prefix: "J01", severity: "critical", limit: 5 },
    ctx4
  );
  if (Array.isArray(r4)) {
    console.log("Got array of length", r4.length, "(no fallback triggered)");
  } else {
    console.log("severity_fallback_applied:", r4.severity_fallback_applied);
    console.log("note:", r4.note);
    console.log("items.length:", r4.items?.length);
    if (r4.items?.[0]) {
      console.log("first item:", r4.items[0].name, r4.items[0].country_code, r4.items[0].severity);
    }
  }
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
