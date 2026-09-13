import {
  compareQuantities,
  displayQuantity,
  isNegativeQuantity,
  localDateIn,
  normalizeAmount,
  normalizeQuantity,
} from '@clinic/contracts'
import type {
  AdjustStockRequest,
  MovementListQuery,
  ReceiveStockRequest,
  StockMovement,
} from '@clinic/contracts'
import { STOCK_MOVEMENT_DIRECTION } from '@clinic/config'
import { BusinessRuleError, ConflictError, NotFoundError, ValidationError } from '../../../errors'
import { pageLimit, type Page } from '../../../pagination'
import { recordAudit } from '../../audit'
import { assertCan, type Actor } from '../../access'
import { getClinicFacts } from '../../clinic'
import { instantOf, nextDate } from '../../scheduling'

import { allocateFefo, allocateFromBatch } from '../domain/stock'
import { itemRepository } from '../infrastructure/item.repository'
import { movementRepository, type StoredMovement } from '../infrastructure/movement.repository'

export function toMovement(movement: StoredMovement): StockMovement {
  return {
    id: movement.id,
    itemId: movement.itemId,
    item: movement.item,
    batchId: movement.batchId,
    batchNumber: movement.batchNumber,
    type: movement.type,
    quantity: movement.quantity,
    balanceAfter: movement.balanceAfter,
    reason: movement.reason,
    encounterId: movement.encounterId,
    invoiceId: movement.invoiceId,
    reference: movement.reference,
    occurredAt: movement.occurredAt.toISOString(),
    performedBy: movement.performedBy,
  }
}

/**
 * Stock arriving (S10).
 *
 * A delivery is one movement and one batch. The expiry is a calendar date in the clinic's zone
 * (ADR-0010), because stock goes out of date on a day rather than at an instant, and a batch
 * that expires "today" is still usable today.
 */
export async function receiveStock(
  actor: Actor,
  itemId: string,
  input: ReceiveStockRequest,
  now: Date = new Date(),
): Promise<StockMovement> {
  await assertCan(actor, 'inventory:manage')

  const [item, clinic] = await Promise.all([
    itemRepository.findById(actor.clinicId, itemId),
    getClinicFacts(actor.clinicId),
  ])
  if (!item) throw new NotFoundError('Inventory item')
  if (!item.isTracked) {
    throw new BusinessRuleError(
      'ITEM_NOT_TRACKED',
      'This item is not counted, so stock cannot be received against it.',
    )
  }

  const quantity = normalizeQuantity(input.quantity)
  if (quantity === null) {
    throw new ValidationError('That is not a quantity this clinic can hold.', [
      { field: 'quantity', issue: 'INVALID_QUANTITY' },
    ])
  }

  const costPrice =
    input.costPrice === null ? null : normalizeAmount(input.costPrice, clinic.currency)
  if (input.costPrice !== null && costPrice === null) {
    throw new ValidationError('That price is not valid for this clinic’s currency.', [
      { field: 'costPrice', issue: 'INVALID_AMOUNT' },
    ])
  }

  const expiresAt = input.expiresAt === '' ? null : input.expiresAt
  const today = localDateIn(clinic.timezone, now)
  if (expiresAt !== null && expiresAt < today) {
    throw new BusinessRuleError(
      'ALREADY_EXPIRED',
      'That stock is already out of date. Record it as wastage rather than a receipt.',
    )
  }

  const received = await itemRepository.receive(actor.clinicId, itemId, {
    quantity,
    batchNumber: input.batchNumber,
    expiresAt,
    costPrice,
    receivedAt: now,
  })
  if (!received) throw new NotFoundError('Inventory item')

  const [movement] = await movementRepository.record([
    {
      clinicId: actor.clinicId,
      itemId: item.id,
      item: { name: item.name, sku: item.sku, unit: item.unit },
      batchId: received.batchId,
      batchNumber: received.batchNumber,
      type: 'RECEIPT',
      quantity,
      balanceAfter: received.balanceAfter,
      reason: input.note,
      encounterId: null,
      invoiceId: null,
      reference: input.reference,
      occurredAt: now,
      performedBy: { id: actor.userId, name: actor.displayName },
    },
  ])
  if (!movement) throw new Error('Failed to write the stock movement')

  await recordAudit({
    action: 'inventory.received',
    category: 'INVENTORY',
    severity: 'INFO',
    clinicId: actor.clinicId,
    entity: { type: 'InventoryItem', id: item.id },
    metadata: {
      sku: item.sku,
      quantity,
      batchNumber: received.batchNumber,
      expiresAt,
      balanceAfter: received.balanceAfter,
    },
  })

  return toMovement(movement)
}

/**
 * Correcting a count, writing stock off, or taking it back (S10).
 *
 * Every one of these needs a reason, because a stock level that changed for no stated cause is
 * the thing a stock-take cannot explain. An ADJUSTMENT may go either way — a count can be wrong
 * in both directions — while wastage only ever goes out and a return only ever comes in, which
 * the direction table settles rather than the caller.
 */
export async function adjustStock(
  actor: Actor,
  itemId: string,
  input: AdjustStockRequest,
  now: Date = new Date(),
): Promise<StockMovement> {
  await assertCan(actor, 'inventory:adjust')

  const [item, clinic] = await Promise.all([
    itemRepository.findById(actor.clinicId, itemId),
    getClinicFacts(actor.clinicId),
  ])
  if (!item) throw new NotFoundError('Inventory item')

  const magnitude = input.quantity.replace('-', '')
  const normalized = normalizeQuantity(magnitude)
  if (normalized === null) {
    throw new ValidationError('That is not a quantity this clinic can hold.', [
      { field: 'quantity', issue: 'INVALID_QUANTITY' },
    ])
  }

  // Wastage is always out and a return always in; only an adjustment takes the caller's sign.
  const direction = STOCK_MOVEMENT_DIRECTION[input.type]
  const outward =
    direction === 'OUT' || (direction === undefined && isNegativeQuantity(input.quantity))
  const signed = outward ? `-${normalized}` : normalized

  const today = localDateIn(clinic.timezone, now)
  let batchId: string | null = input.batchId
  let batchNumber: string | null = null
  let balanceAfter: string

  if (outward && item.isTracked) {
    // Stock leaving has to come out of somewhere specific, or the batches and the total drift
    // apart. Expired stock *is* allocatable here: writing off what has gone out of date is the
    // whole point of a wastage movement.
    const allocation =
      input.batchId !== null
        ? allocateFromBatch(item.batches, input.batchId, normalized, '0000-00-00')
        : allocateFefo(item.batches, normalized, input.type === 'WASTAGE' ? '0000-00-00' : today)

    if (!allocation.ok) {
      throw new BusinessRuleError(
        allocation.reason,
        allocation.reason === 'STOCK_EXPIRED'
          ? `All of the remaining ${item.name} has expired.`
          : `There is only ${displayQuantity(allocation.usable)} ${item.unit} of ${item.name} left.`,
      )
    }

    const moved = await itemRepository.withdraw(
      actor.clinicId,
      item.id,
      allocation.allocations,
      normalized,
    )
    if (!moved) {
      throw new ConflictError('STOCK_CHANGED', 'That stock moved a moment ago. Try again.')
    }
    balanceAfter = moved.balanceAfter
    batchId = allocation.allocations[0]?.batchId ?? null
    batchNumber = allocation.allocations[0]?.batchNumber ?? null
    await itemRepository.pruneEmptyBatches(actor.clinicId, item.id)
  } else {
    // Stock appearing from a recount belongs to no delivery, so it adjusts the total alone.
    const moved = await itemRepository.adjustTotal(actor.clinicId, item.id, signed)
    if (!moved) {
      throw new BusinessRuleError(
        'INSUFFICIENT_STOCK',
        `There is only ${displayQuantity(item.quantityOnHand)} ${item.unit} of ${item.name} left.`,
      )
    }
    balanceAfter = moved.balanceAfter
    batchId = null
  }

  const [movement] = await movementRepository.record([
    {
      clinicId: actor.clinicId,
      itemId: item.id,
      item: { name: item.name, sku: item.sku, unit: item.unit },
      batchId,
      batchNumber,
      type: input.type,
      quantity: signed,
      balanceAfter,
      reason: input.reason,
      encounterId: null,
      invoiceId: null,
      reference: null,
      occurredAt: now,
      performedBy: { id: actor.userId, name: actor.displayName },
    },
  ])
  if (!movement) throw new Error('Failed to write the stock movement')

  await recordAudit({
    action: `inventory.${input.type.toLowerCase()}`,
    category: 'INVENTORY',
    severity: 'NOTICE',
    clinicId: actor.clinicId,
    entity: { type: 'InventoryItem', id: item.id },
    metadata: { sku: item.sku, quantity: signed, balanceAfter, reason: input.reason },
  })

  return toMovement(movement)
}

/** The ledger (S10). What it says, in order, is what explains the number on the shelf. */
export async function listMovements(
  actor: Actor,
  query: Partial<MovementListQuery>,
): Promise<Page<StockMovement>> {
  await assertCan(actor, 'inventory:read')
  const clinic = await getClinicFacts(actor.clinicId)

  const page = await movementRepository.list(
    actor.clinicId,
    {
      itemId: query.itemId,
      encounterId: query.encounterId,
      type: query.type,
      from: query.from ? instantOf(query.from, '00:00', clinic.timezone) : undefined,
      to: query.to ? instantOf(nextDate(query.to), '00:00', clinic.timezone) : undefined,
    },
    { cursor: query.cursor, limit: pageLimit(query.limit) },
  )
  return { items: page.items.map(toMovement), nextCursor: page.nextCursor }
}

/**
 * Does the ledger still explain the balance? Sums every movement an item has ever had and
 * compares it with the projection — the check that makes "the ledger is the truth" verifiable
 * rather than merely asserted (section 8.11).
 */
export async function reconcileItem(
  actor: Actor,
  itemId: string,
): Promise<{ itemId: string; quantityOnHand: string; ledgerTotal: string; agrees: boolean }> {
  await assertCan(actor, 'inventory:read')
  const [item, ledgerTotal] = await Promise.all([
    itemRepository.findById(actor.clinicId, itemId),
    movementRepository.sumFor(actor.clinicId, itemId),
  ])
  if (!item) throw new NotFoundError('Inventory item')

  return {
    itemId: item.id,
    quantityOnHand: item.quantityOnHand,
    ledgerTotal,
    agrees: compareQuantities(item.quantityOnHand, ledgerTotal) === 0,
  }
}
