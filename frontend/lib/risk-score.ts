/**
 * Shared supply-risk scoring function.
 * Used by both the dashboard (PredictedSupplyRisks) and drug detail page.
 *
 * Score components (0–100 total):
 *   Velocity        0-30  — acceleration of shortage reports over last 30 vs prior 30 days
 *   Spread          0-25  — number of countries affected
 *   History         0-20  — status-log transitions (supply volatility)
 *   Trajectory      0-25  — severity escalations + current severity level
 */

export const SEV_RANK: Record<string, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

export interface RiskInput {
  /** Updates in the last 30 days */
  last30: number;
  /** Updates in the 30 days before that */
  prior30: number;
  /** Number of distinct affected countries */
  countryCount: number;
  /** Status-log transition count (last 30d) */
  logEntries: number;
  /** Severity upgrade count (last 30d) */
  escalations: number;
  /** Highest severity rank (0–3) */
  maxSev: number;
}

export interface RiskResult {
  riskScore: number;
  riskLevel: "HIGH RISK" | "ELEVATED" | "WATCH";
  primarySignal: string;
  trending: boolean;
}

export function calculateRiskScore(input: RiskInput): RiskResult {
  // 1. Velocity (0-30): acceleration of updated shortage reports
  let v = 0;
  if (input.prior30 > 0) {
    const accel = input.last30 - input.prior30;
    v = accel * 4 + Math.min(input.last30, 10) * 2;
  } else if (input.last30 > 0) {
    v = input.last30 * 5;
  }
  const velocityScore = Math.max(0, Math.min(30, v));

  // 2. Multi-country spread (0-25)
  const spreadScore = Math.min(25, input.countryCount * 7);

  // 3. Historical pattern (0-20): status-log transitions = supply volatility
  const historyScore = Math.min(20, input.logEntries * 3);

  // 4. Severity trajectory (0-25): escalations + current severity level
  const trajectoryScore = Math.min(25, input.escalations * 8 + input.maxSev * 4);

  const total = velocityScore + spreadScore + historyScore + trajectoryScore;
  const riskScore = Math.min(100, total);

  const riskLevel: RiskResult["riskLevel"] =
    riskScore >= 65 ? "HIGH RISK" : riskScore >= 40 ? "ELEVATED" : "WATCH";

  // Dominant signal
  const signals = [
    { s: velocityScore, l: "Accelerating shortage reports" },
    { s: spreadScore, l: "Spreading across markets" },
    { s: historyScore, l: "Recurring shortage pattern" },
    { s: trajectoryScore, l: "Severity escalating" },
  ];
  signals.sort((a, b) => b.s - a.s);

  return {
    riskScore,
    riskLevel,
    primarySignal: signals[0].l,
    trending: input.last30 > input.prior30 && input.last30 > 2,
  };
}

/** Colour theming for risk levels */
export function riskStyle(level: string) {
  if (level === "HIGH RISK")
    return { color: "#dc2626", bg: "#fef2f2", border: "#fecaca" };
  if (level === "ELEVATED")
    return { color: "#ea580c", bg: "#fff7ed", border: "#fed7aa" };
  return { color: "#ca8a04", bg: "#fefce8", border: "#fef08a" };
}
