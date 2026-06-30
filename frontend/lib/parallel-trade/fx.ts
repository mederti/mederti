/**
 * Indicative FX for parallel-trade spread normalisation.
 *
 * Static, EUR-based, indicative rates. Parallel-trade desks screen on
 * indicative rates and confirm at deal time, so a static table is honest for a
 * screening signal — but it is NOT a live rate. Update FX_AS_OF + the table
 * when refreshing. If a currency isn't here, the price is treated as
 * non-convertible (shown, but excluded from spread maths) rather than guessed.
 *
 * To make this live later: swap toEur() for a cached call to an FX source.
 */

export const FX_AS_OF = "2026-06-01";

// Units of EUR per 1 unit of the currency (EUR = 1.0).
const EUR_PER: Record<string, number> = {
  EUR: 1.0,
  GBP: 1.17,
  USD: 0.92,
  CHF: 1.04,
  SEK: 0.088,
  DKK: 0.134,
  NOK: 0.086,
  PLN: 0.233,
  CZK: 0.04,
  HUF: 0.0025,
  RON: 0.201,
  BGN: 0.511,
};

export function isConvertible(currency: string | null | undefined): boolean {
  return !!currency && currency.toUpperCase() in EUR_PER;
}

/** Convert an amount in `currency` to EUR. Returns null if not convertible. */
export function toEur(amount: number | null | undefined, currency: string | null | undefined): number | null {
  if (amount == null || !currency) return null;
  const rate = EUR_PER[currency.toUpperCase()];
  if (rate == null) return null;
  return amount * rate;
}
