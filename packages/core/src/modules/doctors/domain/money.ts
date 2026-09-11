/** Minor-unit digits for a currency, from the runtime's ISO 4217 data: USD 2, KWD 3, LBP 0. */
export function currencyDigits(currency: string): number {
  return (
    new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
      .maximumFractionDigits ?? 2
  )
}

/**
 * An amount written to exactly the currency's minor digits: "45" becomes "45.00" in dollars and
 * stays "45" in Lebanese pounds. Null when it has more decimals than the currency has — 45.005
 * dollars is not a price anyone can pay, and rounding it silently would change what was typed.
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
