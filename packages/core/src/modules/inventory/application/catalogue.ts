import { localDateIn, normalizeAmount, normalizeQuantity } from '@clinic/contracts'
import { EXPIRING_SOON_DAYS } from '@clinic/config'
import type {
  InventoryItemDetail,
  InventoryItemInput,
  InventoryItemSummary,
  InventoryListQuery,
} from '@clinic/contracts'
import { ConflictError, NotFoundError, ValidationError } from '../../../errors'
import { recordAudit } from '../../audit'
import { assertCan, type Actor } from '../../access'
import { getClinicFacts } from '../../clinic'

import { expiryState, horizonDate, isLowStock, nextExpiry } from '../domain/alerts'
import { itemRepository, type StoredItem } from '../infrastructure/item.repository'
import { categoryRepository } from '../infrastructure/category.repository'
import { supplierRepository } from '../infrastructure/supplier.repository'

/** A MongoDB duplicate-key error, whatever wrapper it arrives in. */
const isDuplicateKey = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: number }).code === 11000

export interface ItemContext {
  currency: string
  today: string
  horizon: string
  categories: Map<string, string>
  suppliers: Map<string, string>
}

/** Everything the list needs to decide low and expiring, read once for the whole page. */
export async function itemContext(actor: Actor, now: Date = new Date()): Promise<ItemContext> {
  const clinic = await getClinicFacts(actor.clinicId)
  const today = localDateIn(clinic.timezone, now)
  const [categories, suppliers] = await Promise.all([
    categoryRepository.list(actor.clinicId, 'all'),
    supplierRepository.list(actor.clinicId, 'all'),
  ])
  return {
    currency: clinic.currency,
    today,
    horizon: horizonDate(today, EXPIRING_SOON_DAYS),
    categories: new Map(categories.map((row) => [row.id, row.name])),
    suppliers: new Map(suppliers.map((row) => [row.id, row.name])),
  }
}

export function toItemSummary(item: StoredItem, context: ItemContext): InventoryItemSummary {
  const soonest = nextExpiry(item.batches)
  const state = expiryState(soonest, context.today, context.horizon)
  const categoryName = item.categoryId ? context.categories.get(item.categoryId) : undefined

  return {
    id: item.id,
    sku: item.sku,
    name: item.name,
    unit: item.unit,
    category: item.categoryId && categoryName ? { id: item.categoryId, name: categoryName } : null,
    currency: context.currency,
    costPrice: item.costPrice,
    salePrice: item.salePrice,
    quantityOnHand: item.quantityOnHand,
    reorderLevel: item.reorderLevel,
    isTracked: item.isTracked,
    isBillable: item.isBillable,
    isActive: item.isActive,
    // An untracked item has no level to be low against — it is not counted at all.
    isLow: item.isTracked && isLowStock(item.quantityOnHand, item.reorderLevel),
    nextExpiryAt: soonest,
    isExpiringSoon: state === 'SOON',
    hasExpired: state === 'EXPIRED',
  }
}

export function toItemDetail(item: StoredItem, context: ItemContext): InventoryItemDetail {
  const supplierName = item.supplierId ? context.suppliers.get(item.supplierId) : undefined
  return {
    ...toItemSummary(item, context),
    description: item.description,
    supplier: item.supplierId && supplierName ? { id: item.supplierId, name: supplierName } : null,
    // Soonest to expire first: the order stock should be reached for, and the order it is used.
    batches: [...item.batches]
      .sort((left, right) => (left.expiresAt ?? '9999').localeCompare(right.expiresAt ?? '9999'))
      .map((batch) => ({
        id: batch.id,
        batchNumber: batch.batchNumber,
        expiresAt: batch.expiresAt,
        quantity: batch.quantity,
        costPrice: batch.costPrice,
        receivedAt: batch.receivedAt ? batch.receivedAt.toISOString() : null,
      })),
  }
}

/** Prices and levels have to be expressible, or the rounding decision lands on whoever renders. */
function validated(input: InventoryItemInput, currency: string): InventoryItemInput {
  for (const field of ['costPrice', 'salePrice'] as const) {
    const value = input[field]
    if (value !== null && normalizeAmount(value, currency) === null) {
      throw new ValidationError('That price is not valid for this clinic’s currency.', [
        { field, issue: 'INVALID_AMOUNT' },
      ])
    }
  }
  if (normalizeQuantity(input.reorderLevel) === null) {
    throw new ValidationError('That is not a quantity this clinic can hold.', [
      { field: 'reorderLevel', issue: 'INVALID_QUANTITY' },
    ])
  }
  return {
    ...input,
    costPrice: input.costPrice === null ? null : normalizeAmount(input.costPrice, currency),
    salePrice: input.salePrice === null ? null : normalizeAmount(input.salePrice, currency),
    reorderLevel: normalizeQuantity(input.reorderLevel) ?? '0',
  }
}

export async function listItems(
  actor: Actor,
  query: InventoryListQuery,
  now: Date = new Date(),
): Promise<InventoryItemSummary[]> {
  await assertCan(actor, 'inventory:read')
  const context = await itemContext(actor, now)
  const items = await itemRepository.list(actor.clinicId, {
    q: query.q,
    categoryId: query.categoryId,
    status: query.status,
  })

  const summaries = items.map((item) => toItemSummary(item, context))
  if (query.view === 'low') return summaries.filter((item) => item.isLow)
  if (query.view === 'expiring') {
    return summaries.filter((item) => item.isExpiringSoon || item.hasExpired)
  }
  return summaries
}

export async function getItem(
  actor: Actor,
  itemId: string,
  now: Date = new Date(),
): Promise<InventoryItemDetail> {
  await assertCan(actor, 'inventory:read')
  const [item, context] = await Promise.all([
    itemRepository.findById(actor.clinicId, itemId),
    itemContext(actor, now),
  ])
  if (!item) throw new NotFoundError('Inventory item')
  return toItemDetail(item, context)
}

export async function createItem(
  actor: Actor,
  input: InventoryItemInput,
  now: Date = new Date(),
): Promise<InventoryItemDetail> {
  await assertCan(actor, 'inventory:manage')
  const context = await itemContext(actor, now)

  try {
    const item = await itemRepository.create(actor.clinicId, validated(input, context.currency))
    await recordAudit({
      action: 'inventory.item_created',
      category: 'INVENTORY',
      severity: 'INFO',
      clinicId: actor.clinicId,
      entity: { type: 'InventoryItem', id: item.id },
      metadata: { sku: item.sku, name: item.name, unit: item.unit },
    })
    return toItemDetail(item, context)
  } catch (error) {
    if (isDuplicateKey(error)) {
      throw new ConflictError('SKU_EXISTS', 'An item with that SKU already exists.', [
        { field: 'sku', issue: 'DUPLICATE' },
      ])
    }
    throw error
  }
}

/**
 * Editing what an item *is*. Never what it holds: a stock level is the ledger's projection, so
 * correcting a count is an adjustment with a reason, not a form field (section 8.11).
 */
export async function updateItem(
  actor: Actor,
  itemId: string,
  input: InventoryItemInput,
  now: Date = new Date(),
): Promise<InventoryItemDetail> {
  await assertCan(actor, 'inventory:manage')
  const context = await itemContext(actor, now)

  try {
    const item = await itemRepository.update(
      actor.clinicId,
      itemId,
      validated(input, context.currency),
    )
    if (!item) throw new NotFoundError('Inventory item')
    return toItemDetail(item, context)
  } catch (error) {
    if (isDuplicateKey(error)) {
      throw new ConflictError('SKU_EXISTS', 'An item with that SKU already exists.', [
        { field: 'sku', issue: 'DUPLICATE' },
      ])
    }
    throw error
  }
}

/** For billing and consumption: the items a request names, by id. */
export async function findItemsForConsumption(
  clinicId: string,
  itemIds: string[],
): Promise<Map<string, StoredItem>> {
  const items = await itemRepository.findMany(clinicId, itemIds)
  return new Map(items.map((item) => [item.id, item]))
}
