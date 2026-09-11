import type { Money } from '@clinic/contracts'

/**
 * Display only. The amount arrives as an exact decimal string; turning it into a number here is
 * safe because nothing is calculated with it, and Intl gives the currency its own symbol and
 * digits. Arithmetic on money never happens in the browser (section 8.3).
 */
export function formatMoney(money: Money, locale: string): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: money.currency }).format(
    Number(money.amount),
  )
}
