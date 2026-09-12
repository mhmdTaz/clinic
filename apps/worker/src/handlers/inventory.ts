import { assertEventPayload, type OutboxEnvelope } from '@clinic/events'
import { usersHolding } from '@clinic/core/access'
import { deliver } from '@clinic/core/notifications'

/**
 * Something is running out.
 *
 * The shelf already shows this — the inventory page derives low stock on read, so the alert is
 * never stale (Phase 6). What a notification adds is that somebody finds out **without opening
 * the page**, which is the difference between noticing on Tuesday and noticing when the last
 * vial is gone.
 *
 * The audience is whoever can restock, resolved from the permission rather than a role name.
 */
export async function onStockLow(envelope: OutboxEnvelope): Promise<void> {
  const payload = assertEventPayload('stock.low', envelope.payload)
  const audience = await usersHolding(envelope.clinicId, 'inventory:manage')
  if (audience.length === 0) return

  await deliver({
    clinicId: envelope.clinicId,
    userIds: audience,
    type: 'STOCK_LOW',
    title: 'Stock is running low',
    body: `${payload.quantityOnHand} left. Time to reorder.`,
    href: `/staff/inventory/${payload.itemId}`,
    entity: { type: 'InventoryItem', id: payload.itemId },
    // Keyed by the level it dropped to, so crossing the line once is one notification and
    // dropping further is a fresh one — but a retry at the same level is silent.
    dedupeKey: `stock.low:${payload.itemId}:${payload.quantityOnHand}`,
  })
}
