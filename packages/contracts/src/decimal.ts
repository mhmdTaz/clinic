/**
 * Exact decimal arithmetic on scaled integers (section 9.2).
 *
 * Two things in this system are counted rather than measured — money and stock — and both are
 * wrong the moment a float touches them. `0.1 + 0.2` is not `0.3`, and three lots of `33.33` is
 * not `99.99` if you go via a double. Everything here runs on `bigint`s scaled by 10^6, so no
 * intermediate value is ever a float, and rounds exactly once at the end.
 *
 * This module is the shared engine. It deliberately knows nothing about currencies or units:
 * money.ts resolves the digits from an ISO 4217 code, quantity.ts fixes them at three. Having
 * one implementation is the point — an exact-arithmetic routine copied twice is an
 * exact-arithmetic routine that will one day disagree with itself.
 */

/**
 * Intermediate precision. Six places is far past any currency's minor unit or any quantity a
 * clinic counts, so a percentage or a fractional multiplier keeps its exactness until the one
 * place rounding is allowed to happen.
 */
const SCALE = 6
const SCALE_FACTOR = 10n ** BigInt(SCALE)

const DECIMAL = /^-?\d+(\.\d+)?$/

/** A decimal string as an integer scaled by 10^6. Throws on anything that is not a number. */
export function scaleDecimal(value: string): bigint {
  const text = value.trim()
  if (!DECIMAL.test(text)) throw new TypeError(`Not a decimal value: ${value}`)
  const negative = text.startsWith('-')
  const [whole = '0', fraction = ''] = text.replace('-', '').split('.')
  const digits = BigInt(`${whole}${fraction.padEnd(SCALE, '0').slice(0, SCALE)}`)
  return negative ? -digits : digits
}

/** Back to a decimal string with `digits` places, rounding half away from zero. */
export function unscaleDecimal(value: bigint, digits: number): string {
  const factor = 10n ** BigInt(SCALE - digits)
  const negative = value < 0n
  const magnitude = negative ? -value : value
  // Half away from zero: 0.005 becomes 0.01, and -0.005 becomes -0.01. Half-even would be
  // defensible statistically and surprising on a receipt (ADR-0027).
  const rounded = (magnitude + factor / 2n) / factor
  const text = rounded.toString().padStart(digits + 1, '0')
  const whole = digits === 0 ? text : text.slice(0, -digits)
  const fraction = digits === 0 ? '' : `.${text.slice(-digits)}`
  return `${negative && rounded !== 0n ? '-' : ''}${whole}${fraction}`
}

export function addAtScale(digits: number, ...values: string[]): string {
  return unscaleDecimal(
    values.reduce((sum, value) => sum + scaleDecimal(value), 0n),
    digits,
  )
}

export function subtractAtScale(digits: number, from: string, value: string): string {
  return unscaleDecimal(scaleDecimal(from) - scaleDecimal(value), digits)
}

/** A value times a plain multiplier, which may itself be fractional ("1.5"). */
export function multiplyAtScale(digits: number, value: string, multiplier: string): string {
  return unscaleDecimal((scaleDecimal(value) * scaleDecimal(multiplier)) / SCALE_FACTOR, digits)
}

/** A percentage of a value: "8.25" percent of "100.00" is "8.25". */
export function percentAtScale(digits: number, value: string, percent: string): string {
  return unscaleDecimal(
    (scaleDecimal(value) * scaleDecimal(percent)) / (SCALE_FACTOR * 100n),
    digits,
  )
}

/** -1, 0 or 1, comparing exactly: "10.00" and "10" are the same value. */
export function compareDecimals(left: string, right: string): -1 | 0 | 1 {
  const difference = scaleDecimal(left) - scaleDecimal(right)
  return difference === 0n ? 0 : difference < 0n ? -1 : 1
}

export function isZeroDecimal(value: string): boolean {
  return scaleDecimal(value) === 0n
}

export function isNegativeDecimal(value: string): boolean {
  return scaleDecimal(value) < 0n
}

/**
 * A non-negative value written to exactly `digits` places, or null when it carries more
 * precision than that allows. This is validation, not arithmetic, so it refuses rather than
 * rounds: silently turning 45.005 into 45.01 changes what somebody typed into what we preferred.
 */
export function normalizeDecimal(value: string, digits: number): string | null {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value.trim())
  if (!match) return null
  const whole = (match[1] ?? '0').replace(/^0+(?=\d)/, '')
  const fraction = match[2] ?? ''
  if (fraction.replace(/0+$/, '').length > digits) return null
  return digits === 0 ? whole : `${whole}.${fraction.padEnd(digits, '0').slice(0, digits)}`
}
