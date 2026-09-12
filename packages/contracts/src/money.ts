import {
  addAtScale,
  compareDecimals,
  isNegativeDecimal,
  isZeroDecimal,
  multiplyAtScale,
  normalizeDecimal,
  percentAtScale,
  subtractAtScale,
  unscaleDecimal,
} from './decimal'

/**
 * Money, as decimal strings and exact integer arithmetic (section 9.2).
 *
 * Amounts travel as strings — "45.00", never 45.0 — because a JSON number is a float and a float
 * cannot hold cents exactly. The arithmetic is the other half of that promise: every operation
 * runs on scaled `bigint`s in decimal.ts, so no intermediate result is ever a float either.
 *
 * It lives in contracts rather than in a module because the server and the screens must agree to
 * the cent. A form that previews a line total differently from the invoice the server writes is a
 * bug the user finds at the till.
 */

/** Minor-unit digits for a currency, from the runtime's ISO 4217 data: USD 2, KWD 3, LBP 0. */
export function currencyDigits(currency: string): number {
  return (
    new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
      .maximumFractionDigits ?? 2
  )
}

/**
 * An amount written to exactly the currency's minor digits: "45" becomes "45.00" in dollars and
 * stays "45" in Lebanese pounds. Null when it carries more decimals than the currency has —
 * 45.005 dollars is not a price anyone can pay, and rounding it silently would change what was
 * typed. This is validation, not arithmetic, so it refuses rather than rounds.
 */
export function normalizeAmount(amount: string, currency: string): string | null {
  return normalizeDecimal(amount, currencyDigits(currency))
}

/** Zero, written for the currency: "0.00" in dollars, "0" in Lebanese pounds. */
export function zeroAmount(currency: string): string {
  return unscaleDecimal(0n, currencyDigits(currency))
}

export function addAmounts(currency: string, ...amounts: string[]): string {
  return addAtScale(currencyDigits(currency), ...amounts)
}

export function subtractAmounts(currency: string, from: string, amount: string): string {
  return subtractAtScale(currencyDigits(currency), from, amount)
}

/**
 * An amount times a plain number — a quantity, which may itself be fractional ("1.5" hours).
 * The product is exact before it is rounded once, at the end.
 */
export function multiplyAmount(currency: string, amount: string, quantity: string): string {
  return multiplyAtScale(currencyDigits(currency), amount, quantity)
}

/** A percentage of an amount: tax at "8.25" percent of "100.00" is "8.25". */
export function percentOf(currency: string, amount: string, percent: string): string {
  return percentAtScale(currencyDigits(currency), amount, percent)
}

/** -1, 0 or 1, comparing exactly: "10.00" and "10" are the same amount of money. */
export const compareAmounts = compareDecimals

export const isZeroAmount = isZeroDecimal

export const isNegativeAmount = isNegativeDecimal

/** True for a well-formed, non-negative amount at or inside the currency's minor digits. */
export function isPayableAmount(amount: string, currency: string): boolean {
  const normalized = normalizeAmount(amount, currency)
  return normalized !== null && !isNegativeAmount(normalized)
}
