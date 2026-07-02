/**
 * Holt double-exponential smoothing + rolling-origin backtest, for the drug
 * price-trend forecast. Pure numeric functions — no I/O, no month labels — so
 * they're unit-testable and reusable.
 *
 * Why Holt and not linear regression: administered/reimbursement prices move as
 * a level with drift (they hold, then step to a new amendment), so a
 * level+trend smoother tracks them far better than a straight line through
 * noisy points. We deliberately do NOT model seasonality — the series are too
 * short and irregular to estimate a seasonal component honestly.
 *
 * The honesty gate lives here: {@link forecastPrice} returns `eligible=false`
 * when there isn't enough real history, or when a rolling backtest shows the
 * model can't predict this particular series well. The caller renders the
 * forecast ONLY when `eligible` is true — otherwise it shows history alone.
 */

export interface HoltForecast {
  /** True only when the series cleared the history + backtest gate. */
  eligible: boolean;
  /** Human reason when not eligible (for logging / a caption), else null. */
  reason: string | null;
  method: "holt" | "none";
  /** Backtest mean absolute percentage error (%), null if not computable. */
  mapePct: number | null;
  /** Central projection, one value per horizon step (always length `horizon`). */
  mid: number[];
  /** Lower / upper prediction-interval bounds (same length as `mid`). */
  lo: number[];
  hi: number[];
  alpha: number | null;
  beta: number | null;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/**
 * Damping factor φ for the trend. Damped-trend Holt multiplies the trend by φ
 * each step forward, so the projection flattens to an asymptote instead of
 * extrapolating a local slope in a straight line (which, on a short noisy price
 * series, happily runs the forecast to zero or to the moon). 0.85 damps firmly
 * — appropriate when the trend is estimated from few, noisy points.
 */
const PHI = 0.85;

/** One-step-ahead fitted values under damped Holt(α, β, φ). fitted[t] predicts
 *  y[t] from data through t-1. Returns the final level and trend for forward
 *  projection. */
function holtPass(y: number[], alpha: number, beta: number) {
  const n = y.length;
  const fitted = new Array<number>(n);
  let level = y[0];
  let trend = n > 1 ? y[1] - y[0] : 0;
  fitted[0] = y[0];
  for (let t = 1; t < n; t++) {
    fitted[t] = level + PHI * trend; // forecast for period t made at t-1
    const prevLevel = level;
    level = alpha * y[t] + (1 - alpha) * (level + PHI * trend);
    trend = beta * (level - prevLevel) + (1 - beta) * PHI * trend;
  }
  return { fitted, level, trend };
}

/** Damped h-step projection from the fitted end-state: level + trend·Σφ^i. */
function projectDamped(level: number, trend: number, horizon: number): number[] {
  const out: number[] = [];
  let phiSum = 0;
  let phiPow = 1;
  for (let k = 1; k <= horizon; k++) {
    phiPow *= PHI;      // φ^k
    phiSum += phiPow;   // Σ_{i=1..k} φ^i
    out.push(level + trend * phiSum);
  }
  return out;
}

/** Sum of squared one-step errors (t ≥ 1) — the objective we minimise. */
function oneStepSSE(y: number[], alpha: number, beta: number): number {
  const { fitted } = holtPass(y, alpha, beta);
  let sse = 0;
  for (let t = 1; t < y.length; t++) {
    const e = y[t] - fitted[t];
    sse += e * e;
  }
  return sse;
}

/** Grid-search (α, β) minimising one-step SSE. A coarse grid is plenty for
 *  series this short and keeps the whole fit deterministic and fast. */
function optimize(y: number[]): { alpha: number; beta: number } {
  let best = { alpha: 0.5, beta: 0.1, sse: Infinity };
  for (let a = 1; a <= 9; a++) {
    for (let b = 0; b <= 6; b++) {
      const alpha = a / 10;
      const beta = b / 10 + 0.02;
      const sse = oneStepSSE(y, alpha, beta);
      if (sse < best.sse) best = { alpha, beta, sse };
    }
  }
  return { alpha: best.alpha, beta: best.beta };
}

/** Std-dev of one-step residuals (t ≥ 1) — drives the prediction interval. */
function residualStd(y: number[], alpha: number, beta: number): number {
  const { fitted } = holtPass(y, alpha, beta);
  const errs: number[] = [];
  for (let t = 1; t < y.length; t++) errs.push(y[t] - fitted[t]);
  if (errs.length < 2) return 0;
  const mean = errs.reduce((s, e) => s + e, 0) / errs.length;
  const varr = errs.reduce((s, e) => s + (e - mean) ** 2, 0) / (errs.length - 1);
  return Math.sqrt(varr);
}

/**
 * Rolling-origin one-step backtest → mean absolute percentage error. For each
 * origin from `minTrain` to n-1 we refit on the prefix and predict the next
 * point, then compare to the held-out actual. This is the honest accuracy
 * number: it measures out-of-sample prediction, not in-sample fit.
 */
function rollingMape(y: number[], minTrain: number): number | null {
  const errs: number[] = [];
  for (let origin = minTrain; origin < y.length; origin++) {
    const train = y.slice(0, origin);
    const { alpha, beta } = optimize(train);
    const { level, trend } = holtPass(train, alpha, beta);
    const pred = level + PHI * trend;
    const actual = y[origin];
    if (actual !== 0) errs.push(Math.abs((actual - pred) / actual));
  }
  if (errs.length === 0) return null;
  return (errs.reduce((s, e) => s + e, 0) / errs.length) * 100;
}

export interface ForecastOpts {
  /** Number of genuinely observed months behind `values` (values may be
   *  forward-filled to a regular grid, so this is the real evidence count). */
  observedCount?: number;
  /** Minimum observed months to attempt a forecast at all. */
  minObserved?: number;
  /** Backtest MAPE (%) above which we refuse to show a forecast. */
  maxMapePct?: number;
  /** z for the prediction interval (1.28 ≈ 80%). */
  z?: number;
}

/**
 * Fit Holt to a regular monthly `values` series and project `horizon` months.
 * Returns `eligible=false` (with a reason) when the series is too short or the
 * backtest error is too high — the caller must not render the forecast then.
 */
export function forecastPrice(values: number[], horizon: number, opts: ForecastOpts = {}): HoltForecast {
  const observedCount = opts.observedCount ?? values.length;
  const minObserved = opts.minObserved ?? 8;
  const maxMapePct = opts.maxMapePct ?? 30;
  const z = opts.z ?? 1.28;

  const none = (reason: string): HoltForecast => ({
    eligible: false, reason, method: "none", mapePct: null,
    mid: [], lo: [], hi: [], alpha: null, beta: null,
  });

  if (values.length < 4) return none("too few points to fit");
  if (observedCount < minObserved) return none(`only ${observedCount} months observed (need ${minObserved})`);
  if (values.some((v) => !Number.isFinite(v))) return none("non-finite value in series");

  // Backtest first — its verdict gates everything. Keep enough training points
  // that the first refit is meaningful.
  const minTrain = Math.max(4, Math.floor(values.length / 2));
  const mapePct = rollingMape(values, minTrain);
  if (mapePct == null) return none("backtest not computable");
  if (mapePct > maxMapePct) return { ...none(`backtest error ${mapePct.toFixed(1)}% exceeds ${maxMapePct}%`), mapePct };

  const alpha = clamp01(optimize(values).alpha);
  const { beta } = optimize(values);
  const { level, trend } = holtPass(values, alpha, beta);
  const sigma = residualStd(values, alpha, beta);

  const projected = projectDamped(level, trend, horizon);
  const mid: number[] = [];
  const lo: number[] = [];
  const hi: number[] = [];
  for (let k = 1; k <= horizon; k++) {
    const point = projected[k - 1];
    // Interval widens with the square root of the horizon (random-walk-of-
    // errors approximation). Prices can't go negative → clamp the floor at 0.
    const half = z * sigma * Math.sqrt(k);
    mid.push(Math.max(0, point));
    lo.push(Math.max(0, point - half));
    hi.push(Math.max(0, point + half));
  }

  return { eligible: true, reason: null, method: "holt", mapePct, mid, lo, hi, alpha, beta };
}
