import { compareQuantities, isZeroQuantity } from '@clinic/contracts'
import type { BatchLike } from './stock'

/**
 * The two questions somebody asks before the cupboard runs out (S10), both derived on read
 * rather than stored — for the same reason an invoice is not stamped OVERDUE. Whether stock is
 * low is a fact about its level *now*; whether it is expiring is a fact about *today*. Storing
 * either means a nightly job whose silent failure leaves every shelf looking healthy.
 */

/**
 * At or below the reorder level. A level of zero means the clinic never wants to be warned about
 * this item — gauze does not need a threshold — so it is not "always low".
 */
export function isLowStock(quantityOnHand: string, reorderLevel: string): boolean {
  if (isZeroQuantity(reorderLevel)) return false
  return compareQuantities(quantityOnHand, reorderLevel) <= 0
}

/** The soonest expiry among the batches that still hold something, or null. */
export function nextExpiry(batches: BatchLike[]): string | null {
  const dates = batches
    .filter((batch) => !isZeroQuantity(batch.quantity))
    .map((batch) => batch.expiresAt)
    .filter((date): date is string => date !== null)
  if (dates.length === 0) return null
  return dates.reduce((soonest, date) => (date < soonest ? date : soonest))
}

export type ExpiryState = 'NONE' | 'SOON' | 'EXPIRED'

/**
 * Where an item's nearest dated stock stands against today. Both are YYYY-MM-DD in the clinic's
 * own zone (ADR-0010), so the comparisons are string comparisons and no clock is involved.
 */
export function expiryState(soonest: string | null, today: string, horizon: string): ExpiryState {
  if (soonest === null) return 'NONE'
  if (soonest < today) return 'EXPIRED'
  return soonest <= horizon ? 'SOON' : 'NONE'
}

/** The calendar date `days` after `today`; the far edge of the expiring-soon window. */
export function horizonDate(today: string, days: number): string {
  const [year = 0, month = 1, day = 1] = today.split('-').map(Number)
  const cursor = new Date(Date.UTC(year, month - 1, day))
  cursor.setUTCDate(cursor.getUTCDate() + days)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${cursor.getUTCFullYear()}-${pad(cursor.getUTCMonth() + 1)}-${pad(cursor.getUTCDate())}`
}
