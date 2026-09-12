import type { StockAlerts } from '@clinic/contracts'
import { assertCan, type Actor } from '../../access'
import { itemRepository } from '../infrastructure/item.repository'
import { itemContext, toItemSummary } from './catalogue'

/**
 * What is about to run out and what is about to go off (S10).
 *
 * Both are derived from the shelf as it is now, never from a stored flag — the same reasoning
 * that keeps OVERDUE off an invoice. A nightly job that stamped these would, on the day it
 * silently stopped, leave every shelf looking healthy.
 *
 * Expired stock is its own list rather than the far end of "expiring": one is a reminder to
 * order, the other is a job to do today.
 */
export async function stockAlerts(actor: Actor, now: Date = new Date()): Promise<StockAlerts> {
  await assertCan(actor, 'inventory:read')
  const [items, context] = await Promise.all([
    itemRepository.list(actor.clinicId, { status: 'active' }),
    itemContext(actor, now),
  ])
  const summaries = items.map((item) => toItemSummary(item, context))

  return {
    low: summaries.filter((item) => item.isLow),
    expiring: summaries.filter((item) => item.isExpiringSoon),
    expired: summaries.filter((item) => item.hasExpired),
  }
}
