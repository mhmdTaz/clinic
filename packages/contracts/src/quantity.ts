import {
  addAtScale,
  compareDecimals,
  isNegativeDecimal,
  isZeroDecimal,
  multiplyAtScale,
  normalizeDecimal,
  subtractAtScale,
  unscaleDecimal,
} from './decimal'

/**
 * Stock quantities, as decimal strings and exact integer arithmetic (section 8.11).
 *
 * The same engine money uses, at a fixed three decimal places. Fractional, because half a vial
 * and a third of a bottle are real amounts a clinic writes down; exact, because a stock level is
 * a running total of every movement ever made and a float would drift a little further from the
 * shelf with each one.
 *
 * Three places is chosen rather than derived: it is past anything a clinic counts by hand, and
 * fixing it means a quantity means the same thing in every item, unlike money, where the
 * currency decides.
 */
export const QUANTITY_DIGITS = 3

/** Zero, written the way every quantity is written: "0.000". */
export function zeroQuantity(): string {
  return unscaleDecimal(0n, QUANTITY_DIGITS)
}

/**
 * A quantity written to exactly three places, or null when it carries more precision than that.
 * Refuses rather than rounds, for the same reason an over-precise price is refused.
 */
export function normalizeQuantity(quantity: string): string | null {
  return normalizeDecimal(quantity, QUANTITY_DIGITS)
}

export function addQuantities(...quantities: string[]): string {
  return addAtScale(QUANTITY_DIGITS, ...quantities)
}

export function subtractQuantities(from: string, quantity: string): string {
  return subtractAtScale(QUANTITY_DIGITS, from, quantity)
}

/** A quantity times a plain multiplier — what three boxes of twelve comes to. */
export function multiplyQuantity(quantity: string, multiplier: string): string {
  return multiplyAtScale(QUANTITY_DIGITS, quantity, multiplier)
}

/** -1, 0 or 1, comparing exactly: "2.000" and "2" are the same amount of stock. */
export const compareQuantities = compareDecimals

export const isZeroQuantity = isZeroDecimal

export const isNegativeQuantity = isNegativeDecimal

/** The same value with its sign flipped — an "out" movement from an "in" quantity. */
export function negateQuantity(quantity: string): string {
  return subtractQuantities(zeroQuantity(), quantity)
}

/** Trims a stored quantity to what a person would write: "2.000" reads as "2". */
export function displayQuantity(quantity: string): string {
  if (!quantity.includes('.')) return quantity
  return quantity.replace(/\.?0+$/, '') || '0'
}
