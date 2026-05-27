// Smoke + acceptance tests for the 5 Sprint 1 Step 5 tools.
// Hits live Supabase via the same getSupabase() the chat tools use, then
// asserts each tool returns a sane confidence + envelope shape.
//
// Run: cd frontend && node ../scripts/test_step5_tools.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { executeTool, newContext } from "../frontend/lib/chat/tools.ts";

function isUnanswerable(r) {
  return r && typeof r === "object" && "status" in r && r.status === "unanswerable";
}
function hasConfidence(r) {
  return r && typeof r === "object" && r.confidence && ["low", "medium", "high"].includes(r.confidence.level);
}

test("get_sole_source_essentials — happy path AU", async () => {
  const r = await executeTool("get_sole_source_essentials", { country: "AU", who_only: true, limit: 5 }, newContext());
  assert.ok(r && typeof r === "object");
  assert.ok(hasConfidence(r), "missing confidence block");
  assert.equal(r.country, "AU");
  assert.ok("items" in r);
  assert.ok(Array.isArray(r.items));
  assert.ok("notes" in r);
  console.log(`  AU sole-source WHO essentials: ${r.sole_source_count}/${r.total_candidates_checked} drugs; confidence=${r.confidence.level}`);
});

test("get_sole_source_essentials — not-indexed country → unanswerable envelope", async () => {
  const r = await executeTool("get_sole_source_essentials", { country: "ZW" }, newContext()); // Zimbabwe — not in coverage
  assert.ok(isUnanswerable(r), `expected unanswerable, got ${JSON.stringify(r).slice(0, 200)}`);
  console.log(`  ZW (not-indexed): reason=${r.reason}`);
});

test("get_sole_source_essentials — missing country → unanswerable", async () => {
  const r = await executeTool("get_sole_source_essentials", { country: "" }, newContext());
  assert.ok(isUnanswerable(r));
  assert.equal(r.reason, "missing_country");
});

test("compare_shortage_burden — happy path AU vs peers", async () => {
  const r = await executeTool("compare_shortage_burden", { country: "AU" }, newContext());
  assert.ok(r && typeof r === "object");
  assert.ok(hasConfidence(r));
  assert.equal(r.focal_country, "AU");
  assert.ok(Array.isArray(r.peer_set));
  assert.ok(Array.isArray(r.per_country));
  assert.ok(r.per_country.length > 1, "expected multiple countries in comparison");
  const focal = r.per_country.find((c) => c.is_focal);
  assert.ok(focal, "focal country must be in per_country");
  console.log(`  AU vs ${r.peer_set.length} peers: ${r.per_country.length} countries; ${r.unique_to_focal_count} unique to AU; confidence=${r.confidence.level}`);
});

test("compare_shortage_burden — custom peer_set", async () => {
  const r = await executeTool("compare_shortage_burden", { country: "AU", peer_set: ["NZ", "GB"] }, newContext());
  assert.equal(r.peer_set.length, 2);
  assert.deepEqual(r.peer_set, ["NZ", "GB"]);
});

test("get_class_concentration_risk — J01 antibacterials", async () => {
  const r = await executeTool("get_class_concentration_risk", { atc_prefix: "J01", limit: 10 }, newContext());
  assert.ok(r && typeof r === "object");
  assert.ok(hasConfidence(r));
  assert.equal(r.atc_prefix, "J01");
  assert.ok(r.drugs_in_class > 0, "expected J01 to have drugs");
  assert.ok(Array.isArray(r.items));
  assert.ok("tier_distribution" in r);
  console.log(`  J01: ${r.drugs_in_class} drugs in class; tier=${JSON.stringify(r.tier_distribution)}; confidence=${r.confidence.level}`);
});

test("get_class_concentration_risk — invalid prefix → unanswerable", async () => {
  const r = await executeTool("get_class_concentration_risk", { atc_prefix: "ZZZ999" }, newContext());
  assert.ok(isUnanswerable(r));
});

test("get_class_concentration_risk — missing prefix → unanswerable", async () => {
  const r = await executeTool("get_class_concentration_risk", {}, newContext());
  assert.ok(isUnanswerable(r));
  assert.equal(r.reason, "missing_atc_prefix");
});

test("get_resolution_time_stats — by ATC class J01", async () => {
  const r = await executeTool("get_resolution_time_stats", { atc_prefix: "J01" }, newContext());
  assert.ok(r && typeof r === "object");
  assert.ok(hasConfidence(r));
  // Either we got stats or a structured unanswerable for thin data — both are OK
  if (!isUnanswerable(r)) {
    assert.ok("n_resolved_events" in r);
    assert.ok(r.n_resolved_events >= 0);
    console.log(`  J01 resolution: n=${r.n_resolved_events}, median=${r.median_days}d (p25=${r.p25_days}, p75=${r.p75_days}); confidence=${r.confidence.level}`);
  } else {
    console.log(`  J01 resolution: unanswerable — ${r.reason}`);
  }
});

test("get_resolution_time_stats — no scope → unanswerable", async () => {
  const r = await executeTool("get_resolution_time_stats", {}, newContext());
  assert.ok(isUnanswerable(r));
  assert.equal(r.reason, "missing_scope");
});

test("get_predictive_signals — happy path AU", async () => {
  const r = await executeTool("get_predictive_signals", { country: "AU" }, newContext());
  assert.ok(r && typeof r === "object");
  assert.ok(hasConfidence(r));
  assert.equal(r.country, "AU");
  assert.ok(Array.isArray(r.peer_set));
  assert.ok(Array.isArray(r.results));
  console.log(`  AU predictive: ${r.total_candidates} candidates, top ${r.results.length}; confidence=${r.confidence.level}`);
});

test("get_predictive_signals — not-indexed country → unanswerable", async () => {
  const r = await executeTool("get_predictive_signals", { country: "ZW" }, newContext());
  assert.ok(isUnanswerable(r));
});
