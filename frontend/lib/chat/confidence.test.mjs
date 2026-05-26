// Unit tests for the confidence helper.
// Run via:  node --test frontend/lib/chat/confidence.test.mjs
//
// Acceptance cases per Sprint 1 Step 4:
//   • stale + single source → low
//   • fresh + multi source → high
//   • missing reliability defaults safely (no throws, sane mid score)
// Plus targeted coverage of the override path and edge inputs.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  computeConfidence,
  confidenceFromSources,
  freshnessFactor,
  levelFromScore,
} from "./confidence.ts";

const today = new Date().toISOString();
const daysAgo = (n) => new Date(Date.now() - n * 86400_000).toISOString();

test("levelFromScore: thresholds match audit §7.2", () => {
  assert.equal(levelFromScore(0.9), "high");
  assert.equal(levelFromScore(0.75), "high"); // boundary inclusive
  assert.equal(levelFromScore(0.6), "medium");
  assert.equal(levelFromScore(0.5), "medium"); // boundary inclusive
  assert.equal(levelFromScore(0.49), "low");
  assert.equal(levelFromScore(0), "low");
});

test("freshnessFactor: monotonic and bounded", () => {
  assert.ok(freshnessFactor(0) === 1.0);
  assert.ok(freshnessFactor(1) > freshnessFactor(7));
  assert.ok(freshnessFactor(7) > freshnessFactor(14));
  assert.ok(freshnessFactor(14) > freshnessFactor(30));
  assert.ok(freshnessFactor(30) > freshnessFactor(90));
  assert.ok(freshnessFactor(Infinity) >= 0.1);
  assert.ok(freshnessFactor(-1) >= 0.1); // negative/invalid floors to 0.1
  // Stale boundary — 7 days+ should be ≤ 0.7
  assert.ok(freshnessFactor(7) <= 0.71);
  assert.ok(freshnessFactor(8) <= 0.70);
});

test("computeConfidence: stale + single source → low", () => {
  const c = computeConfidence({
    sourceReliability: 0.9,  // TGA-grade reliability
    signalCount: 1,
    freshnessDays: 30,
  });
  assert.equal(c.level, "low");
  assert.ok(c.score < 0.5, `expected score<0.5 got ${c.score}`);
  assert.match(c.basis, /1 signal/);
});

test("computeConfidence: fresh + multi source → high", () => {
  const c = computeConfidence({
    sourceReliability: 0.9,
    signalCount: 5,
    freshnessDays: 0,
  });
  assert.equal(c.level, "high");
  assert.ok(c.score >= 0.75, `expected score≥0.75 got ${c.score}`);
});

test("computeConfidence: missing reliability defaults to 0.5 safely", () => {
  const c = computeConfidence({
    sourceReliability: NaN,
    signalCount: 3,
    freshnessDays: 0,
  });
  assert.equal(c.level, "medium");
  assert.ok(c.score > 0.4 && c.score < 0.6, `expected mid score, got ${c.score}`);
});

test("computeConfidence: infinity freshness floors to 0.1 multiplier", () => {
  const c = computeConfidence({
    sourceReliability: 0.95,
    signalCount: 10,
    freshnessDays: Infinity,
  });
  assert.equal(c.level, "low");
  assert.ok(c.score < 0.2, `expected very low score, got ${c.score}`);
});

test("computeConfidence: per-signal override (sourceConfidenceOverride) wins", () => {
  const c = computeConfidence({
    sourceReliability: 0.1,
    signalCount: 0,
    freshnessDays: Infinity,
    sourceConfidenceOverride: 85,
  });
  assert.equal(c.level, "high");
  assert.equal(c.score, 0.85);
  assert.match(c.basis, /override/i);
});

test("computeConfidence: zero signal count → low even with great reliability", () => {
  const c = computeConfidence({
    sourceReliability: 1.0,
    signalCount: 0,
    freshnessDays: 0,
  });
  assert.equal(c.level, "low");
  assert.equal(c.score, 0);
});

test("confidenceFromSources: empty array → low + no-sources basis", () => {
  const c = confidenceFromSources([]);
  assert.equal(c.level, "low");
  assert.equal(c.score, 0);
  assert.match(c.basis, /no backing/i);
});

test("confidenceFromSources: single stale source → low with stale flag in basis", () => {
  const c = confidenceFromSources([
    {
      regulator_code: "FAMHP",
      regulator_name: "FAMHP",
      country_code: "BE",
      rows_contributed: 1,
      latest_event_date: null,
      last_scraped_at: daysAgo(20),
      source_url: null,
      freshness_label: "scraped 20d ago — stale",
      is_stale: true,
      reliability_weight: 0.85,
    },
  ]);
  assert.equal(c.level, "low");
  assert.match(c.basis, /FAMHP/);
  assert.match(c.basis, /stale/);
});

test("confidenceFromSources: multi-regulator + fresh → high", () => {
  const c = confidenceFromSources([
    {
      regulator_code: "TGA",
      regulator_name: "TGA",
      country_code: "AU",
      rows_contributed: 3,
      latest_event_date: today,
      last_scraped_at: today,
      source_url: null,
      freshness_label: "scraped today",
      is_stale: false,
      reliability_weight: 0.95,
    },
    {
      regulator_code: "AIFA",
      regulator_name: "AIFA",
      country_code: "IT",
      rows_contributed: 2,
      latest_event_date: today,
      last_scraped_at: today,
      source_url: null,
      freshness_label: "scraped today",
      is_stale: false,
      reliability_weight: 0.9,
    },
  ]);
  assert.equal(c.level, "high");
  assert.match(c.basis, /TGA \+ AIFA|TGA/);
  assert.match(c.basis, /scraped today/);
});

test("confidenceFromSources: reliability_weight missing → defaults to 0.7", () => {
  const c = confidenceFromSources([
    {
      regulator_code: "TGA",
      regulator_name: "TGA",
      country_code: "AU",
      rows_contributed: 3,
      latest_event_date: today,
      last_scraped_at: today,
      source_url: null,
      freshness_label: "scraped today",
      is_stale: false,
      // reliability_weight intentionally omitted
    },
  ]);
  // 0.7 × 1.0 × 1.0 = 0.7 → medium
  assert.equal(c.level, "medium");
});

test("confidenceFromSources: freshest source anchors the freshness penalty", () => {
  // One fresh source + one ancient source — freshest should dominate.
  const c = confidenceFromSources([
    {
      regulator_code: "TGA",
      regulator_name: "TGA",
      country_code: "AU",
      rows_contributed: 5,
      latest_event_date: today,
      last_scraped_at: today,
      source_url: null,
      freshness_label: "scraped today",
      is_stale: false,
      reliability_weight: 0.95,
    },
    {
      regulator_code: "FAMHP",
      regulator_name: "FAMHP",
      country_code: "BE",
      rows_contributed: 1,
      latest_event_date: daysAgo(60),
      last_scraped_at: daysAgo(60),
      source_url: null,
      freshness_label: "scraped 60d ago — stale",
      is_stale: true,
      reliability_weight: 0.85,
    },
  ]);
  assert.equal(c.level, "high");
  // basis should mention the stale-source caveat
  assert.match(c.basis, /stale/);
});
