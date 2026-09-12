/**
 * Money, as decimal strings and exact integer arithmetic (section 9.2).
 *
 * Amounts travel as strings — "45.00", never 45.0 — because a JSON number is a float and a float
 * cannot hold cents exactly. The arithmetic here is the other half of that promise: every
 * operation runs on scaled `bigint`s, so no intermediate result is ever a float either.
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
 * Intermediate precision. Six places is far past any currency's minor unit, so a percentage or a
 * fractional quantity keeps its exactness until the one place rounding is allowed to happen.
 */
const SCALE = 6
const SCALE_FACTOR = 10n ** BigInt(SCALE)

const DECIMAL = /^-?\d+(\.\d+)?$/

/** A decimal string as an integer scaled by 10^6. Throws on anything that is not a number. */
function scaled(amount: string): bigint {
  const value = amount.trim()
  if (!DECIMAL.test(value)) throw new TypeError(`Not a decimal amount: ${amount}`)
  const negative = value.startsWith('-')
  const [whole = '0', fraction = ''] = value.replace('-', '').split('.')
  const digits = BigInt(`${whole}${fraction.padEnd(SCALE, '0').slice(0, SCALE)}`)
  return negative ? -digits : digits
}

/** Back to a decimal string with `digits` places, rounding half away from zero. */
function unscaled(value: bigint, digits: number): string {
  const factor = 10n ** BigInt(SCALE - digits)
  const negative = value < 0n
  const magnitude = negative ? -value : value
  // Half away from zero: 0.005 becomes 0.01, and -0.005 becomes -0.01. Half-even would be
  // defensible statistically and surprising on a receipt.
  const rounded = (magnitude + factor / 2n) / factor
  const text = rounded.toString().padStart(digits + 1, '0')
  const whole = digits === 0 ? text : text.slice(0, -digits)
  const fraction = digits === 0 ? '' : `.${text.slice(-digits)}`
  return `${negative && rounded !== 0n ? '-' : ''}${whole}${fraction}`
}

/**
 * An amount written to exactly the currency's minor digits: "45" becomes "45.00" in dollars and
 * stays "45" in Lebanese pounds. Null when it carries more decimals than the currency has —
 * 45.005 dollars is not a price anyone can pay, and rounding it silently would change what was
 * typed. This is validation, not arithmetic, so it refuses rather than rounds.
 */
export function normalizeAmount(amount: string, currency: string): string | null {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(amount.trim())
  if (!match) return null
  const whole = (match[1] ?? '0').replace(/^0+(?=\d)/, '')
  const fraction = match[2] ?? ''
  const digits = currencyDigits(currency)
  if (fraction.replace(/0+$/, '').length > digits) return null
  return digits === 0 ? whole : `${whole}.${fraction.padEnd(digits, '0').slice(0, digits)}`
}

/** Zero, written for the currency: "0.00" in dollars, "0" in Lebanese pounds. */
export function zeroAmount(currency: string): string {
  return unscaled(0n, currencyDigits(currency))
}

export function addAmounts(currency: string, ...amounts: string[]): string {
  const total = amounts.reduce((sum, amount) => sum + scaled(amount), 0n)
  return unscaled(total, currencyDigits(currency))
}

export function subtractAmounts(currency: string, from: string, amount: string): string {
  return unscaled(scaled(from) - scaled(amount), currencyDigits(currency))
}

/**
 * An amount times a plain number — a quantity, which may itself be fractional ("1.5" hours).
 * The product is exact before it is rounded once, at the end.
 */
export function multiplyAmount(currency: string, amount: string, quantity: string): string {
  const product = (scaled(amount) * scaled(quantity)) / SCALE_FACTOR
  return unscaled(product, currencyDigits(currency))
}

/** A percentage of an amount: tax at "8.25" percent of "100.00" is "8.25". */
export function percentOf(currency: string, amount: string, percent: string): string {
  const product = (scaled(amount) * scaled(percent)) / (SCALE_FACTOR * 100n)
  return unscaled(product, currencyDigits(currency))
}

/** -1, 0 or 1, comparing exactly: "10.00" and "10" are the same amount of money. */
export function compareAmounts(left: string, right: string): -1 | 0 | 1 {
  const difference = scaled(left) - scaled(right)
  return difference === 0n ? 0 : difference < 0n ? -1 : 1
}

export function isZeroAmount(amount: string): boolean {
  return scaled(amount) === 0n
}

export function isNegativeAmount(amount: string): boolean {
  return scaled(amount) < 0n
}

/** True for a well-formed, non-negative amount at or inside the currency's minor digits. */
export function isPayableAmount(amount: string, currency: string): boolean {
  const normalized = normalizeAmount(amount, currency)
  return normalized !== null && !isNegativeAmount(normalized)
}
