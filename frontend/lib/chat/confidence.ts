// Confidence helper v1 — rules-based scoring shared across all chat tools.
//
// Per docs/persona-coverage-audit.md §7.2, every tool that returns numeric or
// row-based results must also return a `confidence` object. This module is
// the single source of truth for how that score is composed.
//
// score = sourceReliability × min(1, signalCount/3) × freshnessFactor(days)
//   • sourceReliability — from data_sources.reliability_weight (0..1)
//   • signalCount       — rows of evidence the answer is built on
//   • freshnessFactor   — penalty applied to stale scrape signals
//
// level: ≥0.75 high | 0.50–0.74 medium | <0.50 low
//
// The model uses `level` to decide hedging language; the rendered chat UI uses
// `basis` to show users why the answer is calibrated the way it is.

import type { SourceConsulted } from "./types";

export type ConfidenceLevel = "low" | "medium" | "high";

export type Confidence = {
  level: ConfidenceLevel;
  /** 0..1 raw score. Don't render directly; use `level` for prose, `basis` for explanation. */
  score: number;
  /** Human-readable explanation, e.g. "TGA + AIFA (reliability 0.9), 5 events, scraped today". */
  basis: string;
};

export type ComputeConfidenceInput = {
  /** Reliability weight 0..1. From data_sources.reliability_weight, default 0.5 when unknown. */
  sourceReliability: number;
  /** Number of supporting rows / signals. */
  signalCount: number;
  /** Age of the freshest backing scrape in days. Use Infinity if unknown. */
  freshnessDays: number;
  /**
   * Per-shortage_events.source_confidence_score (0..100). When set, overrides
   * the reliability/freshness math for THIS specific signal. Null → use the
   * derived score from the other inputs.
   */
  sourceConfidenceOverride?: number | null;
};

/**
 * Convert age-in-days into a 0..1 freshness multiplier. Calibrated against
 * the audit's 7-day stale threshold:
 *
 *   0d   → 1.00 (fresh)
 *   1d   → 0.97
 *   7d   → 0.70  (boundary — anything past this is "stale")
 *  14d   → 0.50
 *  30d   → 0.30
 *  90d   → 0.15
 *  inf   → 0.10  (unknown freshness)
 */
export function freshnessFactor(days: number): number {
  if (!Number.isFinite(days) || days < 0) return 0.1;
  if (days <= 1) return Math.max(0.95, 1 - 0.03 * days);
  if (days <= 7) return 1.0 - (days - 1) * 0.05; // 1d → 0.97, 7d → 0.70 (≈)
  if (days <= 14) return 0.7 - (days - 7) * 0.0286; // 7d → 0.70, 14d → 0.50
  if (days <= 30) return 0.5 - (days - 14) * 0.0125; // 14d → 0.50, 30d → 0.30
  if (days <= 90) return 0.3 - (days - 30) * 0.0025; // 30d → 0.30, 90d → 0.15
  return 0.1;
}

/** Map a raw 0..1 score to a categorical level. */
export function levelFromScore(score: number): ConfidenceLevel {
  if (score >= 0.75) return "high";
  if (score >= 0.5) return "medium";
  return "low";
}

/**
 * Compute confidence from primitive inputs.
 * Use {@link confidenceFromSources} when you have a SourceConsulted[] in hand
 * (the more common path inside chat tools).
 */
export function computeConfidence(opts: ComputeConfidenceInput): Confidence {
  // sourceConfidenceOverride is on a 0..100 scale (matches schema column).
  // When present, it sets the score directly; the rest of the math is ignored.
  if (typeof opts.sourceConfidenceOverride === "number" && !Number.isNaN(opts.sourceConfidenceOverride)) {
    const score = clamp01(opts.sourceConfidenceOverride / 100);
    return {
      level: levelFromScore(score),
      score,
      basis: `Per-signal override: source_confidence_score=${opts.sourceConfidenceOverride}.`,
    };
  }

  // Safe defaults — never throw on missing inputs.
  const reliability = clamp01(
    Number.isFinite(opts.sourceReliability) ? opts.sourceReliability : 0.5
  );
  const count = Math.max(0, Math.floor(opts.signalCount));
  const days = Number.isFinite(opts.freshnessDays) ? opts.freshnessDays : Infinity;

  // signalCountFactor: 1 row = thin (0.33), 2 = moderate (0.67), 3+ = full (1.0).
  // Diminishing returns past 3 — beyond there, more rows don't improve confidence,
  // they're just more of the same signal.
  const signalCountFactor = Math.min(1, count / 3);

  const fresh = freshnessFactor(days);
  const score = clamp01(reliability * signalCountFactor * fresh);

  const basis = composeBasisFromPrimitives(reliability, count, days, fresh);

  return { level: levelFromScore(score), score, basis };
}

/**
 * Compute confidence from the SourceConsulted[] block that every Mederti tool
 * already builds. Aggregates reliability across sources weighted by row count,
 * and picks the FRESHEST source's age for the freshness penalty (one fresh
 * source is enough to ground the answer).
 *
 * sources_consulted now carries `reliability_weight` (added by the extended
 * computeSourcesConsulted in tools.ts). When that field is absent — older
 * call sites that haven't been migrated yet — falls back to a 0.7 default
 * which is the median data_sources.reliability_weight in production.
 */
export function confidenceFromSources(
  sources: ReadonlyArray<SourceConsulted & { reliability_weight?: number }>,
  opts?: {
    /** Optional per-signal override; set when a single shortage_events row has source_confidence_score. */
    sourceConfidenceOverride?: number | null;
    /** Optional override for total signal count (e.g. landscape queries count drugs, not regulators). */
    signalCount?: number;
  }
): Confidence {
  if (!sources || sources.length === 0) {
    return {
      level: "low",
      score: 0,
      basis: "No backing sources for this answer.",
    };
  }

  const totalRows = opts?.signalCount ?? sources.reduce((s, x) => s + (x.rows_contributed || 0), 0);

  // Weighted reliability average — sources contributing more rows count more.
  const weightedSum = sources.reduce(
    (acc, s) => acc + (s.reliability_weight ?? 0.7) * (s.rows_contributed || 1),
    0
  );
  const weightSum = sources.reduce((acc, s) => acc + (s.rows_contributed || 1), 0);
  const aggReliability = weightSum > 0 ? weightedSum / weightSum : 0.7;

  // Pick the freshest source's age (lowest days-since-scrape). If a regulator
  // scraped today AND another is stale 30d ago, the fresh one anchors confidence.
  let minFreshDays = Infinity;
  for (const s of sources) {
    const days = ageInDays(s.last_scraped_at) ?? ageInDays(s.latest_event_date) ?? Infinity;
    if (days < minFreshDays) minFreshDays = days;
  }

  const conf = computeConfidence({
    sourceReliability: aggReliability,
    signalCount: totalRows,
    freshnessDays: minFreshDays,
    sourceConfidenceOverride: opts?.sourceConfidenceOverride,
  });

  // Compose richer basis text from the SourceConsulted block.
  const top = [...sources]
    .sort((a, b) => (b.rows_contributed || 0) - (a.rows_contributed || 0))
    .slice(0, 3);
  const regulators = top.map((s) => s.regulator_code).join(" + ");
  const freshestLabel = top
    .map((s) => s.freshness_label)
    .find((l) => l && !l.includes("stale") && !l.includes("unknown"));
  const staleNote = sources.some((s) => s.is_stale)
    ? " (some sources stale)"
    : "";

  return {
    ...conf,
    basis: `${regulators}, ${totalRows} event${totalRows === 1 ? "" : "s"}, ${
      freshestLabel ?? sources[0]?.freshness_label ?? "freshness unknown"
    }${staleNote}.`,
  };
}

// ── internals ──────────────────────────────────────────────────────────────

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function ageInDays(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return null;
  const ms = Date.now() - ts;
  if (ms < 0) return 0;
  return ms / (1000 * 60 * 60 * 24);
}

function composeBasisFromPrimitives(
  reliability: number,
  count: number,
  days: number,
  freshFactor: number
): string {
  const rel = `reliability ${reliability.toFixed(2)}`;
  const cnt = `${count} signal${count === 1 ? "" : "s"}`;
  let fresh: string;
  if (!Number.isFinite(days)) fresh = "freshness unknown";
  else if (days < 1) fresh = "scraped today";
  else if (days < 7) fresh = `${Math.round(days)}d old`;
  else fresh = `${Math.round(days)}d old (stale)`;
  const factor = `freshness×${freshFactor.toFixed(2)}`;
  return `${rel}, ${cnt}, ${fresh}, ${factor}.`;
}
