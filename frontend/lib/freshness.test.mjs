// Unit tests for the /freshness classification rules.
// Run via:  node --test frontend/lib/freshness.test.mjs   (Node ≥ 23 strips TS types)

import { test } from "node:test";
import assert from "node:assert/strict";

import { classify, STALL_RUNS } from "./freshness.ts";

const NOW = Date.parse("2026-10-26T00:00:00Z");
const ago = (h) => new Date(NOW - h * 3_600_000).toISOString();
const src = (over = {}) => ({
  id: "s", abbreviation: "X", name: "X", country: "Nowhere", country_code: "XX",
  region: null, source_url: null, scrape_frequency_hours: 24,
  last_scraped_at: ago(3), is_active: true, ...over,
});
const runs = (statuses, everyH = 24) =>
  statuses.map((status, i) => ({ status, scraped_at: ago(3 + i * everyH) }));

test("no last_scraped_at is never 'on schedule'", () => {
  const r = classify(src({ last_scraped_at: null }), runs(["failed"]), null, false, NOW);
  assert.equal(r.job_state, "never");
  assert.equal(r.upstream_state, "not_assessable");
});

test("overdue with recent failed attempts is 'failing', without attempts 'not_running'", () => {
  const old = ago(24 * 40);
  assert.equal(classify(src({ last_scraped_at: old }), runs(["failed", "failed"]), null, false, NOW).job_state, "failing");
  assert.equal(classify(src({ last_scraped_at: old }), [], null, false, NOW).job_state, "not_running");
});

test("identical-payload streak needs N runs AND N cadence intervals", () => {
  const dupDaily = runs(Array(STALL_RUNS + 1).fill("duplicate"));
  assert.equal(classify(src(), dupDaily, null, false, NOW).upstream_state, "suspected_stall");
  // Same count, but 6-hourly runs: under two days of silence is not a stall.
  const dupFast = runs(Array(STALL_RUNS + 1).fill("duplicate").concat("processed"), 6);
  assert.equal(classify(src({ scrape_frequency_hours: 6 }), dupFast, null, false, NOW).upstream_state, "not_measured");
});

test("failed runs don't break an identical streak", () => {
  const r = classify(src(), runs(["duplicate", "failed", "duplicate", "processed"]), null, false, NOW);
  assert.equal(r.identical_payload_runs, 2);
});

test("baseline date is 'measuring', never 'advancing'", () => {
  const base = { last_run_at: ago(3), newest_source_date: "2026-10-20", newest_source_date_unchanged_runs: 2 };
  const r = classify(src({ ...base, newest_source_date_first_seen_at: null }), runs(["processed"]), null, true, NOW);
  assert.equal(r.upstream_state, "measuring");
  const a = classify(src({ ...base, newest_source_date_first_seen_at: ago(30) }), runs(["processed"]), null, true, NOW);
  assert.equal(a.upstream_state, "advancing");
});

test("tracked date unchanged for N runs over N days is a suspected stall", () => {
  const r = classify(
    src({ last_run_at: ago(3), newest_source_date: "2026-09-01", newest_source_date_unchanged_runs: STALL_RUNS + 2,
          newest_source_date_first_seen_at: ago(24 * 20) }),
    runs(["processed"]), null, true, NOW,
  );
  assert.equal(r.upstream_state, "suspected_stall");
  assert.equal(r.newest_source_date_basis, "tracked_runs");
});

test("stored-records date is labelled as such and never drives 'advancing'", () => {
  const r = classify(src(), runs(["processed"]), "2026-10-20", false, NOW);
  assert.equal(r.newest_source_date_basis, "stored_records");
  assert.equal(r.upstream_state, "not_measured");
});
