import { InventoryItemModel, decimal128, newId } from '@clinic/db'
import { addQuantities, negateQuantity } from '@clinic/contracts'
import { sessionOf, type Transaction } from '../../../transaction'
import {
  decodeCursor,
  keysetAfter,
  pageFrom,
  sortFor,
  type Page,
  type SortKey,
} from '../../../pagination'
import type { BatchAllocation, BatchLike } from '../domain/stock'

/** Mongoose hands back a Decimal128; stock leaves this file as the decimal string it is. */
type Decimalish = { toString(): string } | string | number | null | undefined

const decimal = (value: Decimalish, fallback: string | null = null): string | null =>
  value === null || value === undefined ? fallback : String(value)

/**
 * Every quantity leaves this file at three places, whatever scale it happens to be stored at.
 *
 * Decimal128 keeps the scale it was written with, so a shelf stocked with "6" reads back as "6"
 * while one stocked with "6.000" reads back as "6.000" — the same amount of stock in two shapes.
 * Callers compare these strings and render them, so the shape is part of the contract, not an
 * incidental detail of how a delivery happened to be typed.
 */
const asQuantity = (value: Decimalish): string => addQuantities(decimal(value, '0') ?? '0')

export interface StoredBatch extends BatchLike {
  costPrice: string | null
  receivedAt: Date | null
}

export interface StoredItem {
  id: string
  sku: string
  name: string
  description: string | null
  categoryId: string | null
  supplierId: string | null
  unit: string
  costPrice: string | null
  salePrice: string | null
  quantityOnHand: string
  reorderLevel: string
  batches: StoredBatch[]
  isTracked: boolean
  isBillable: boolean
  isActive: boolean
}

export interface ItemWrite {
  sku: string
  name: string
  description: string | null
  categoryId: string | null
  supplierId: string | null
  unit: string
  costPrice: string | null
  salePrice: string | null
  reorderLevel: string
  isTracked: boolean
  isBillable: boolean
  isActive: boolean
}

interface BatchRecord {
  _id: string
  batchNumber?: string | null
  expiresAt?: string | null
  quantity?: Decimalish
  costPrice?: Decimalish
  receivedAt?: Date | null
}

interface ItemRecord {
  _id: string
  sku: string
  name: string
  description?: string | null
  categoryId?: string | null
  supplierId?: string | null
  unit: string
  costPrice?: Decimalish
  salePrice?: Decimalish
  quantityOnHand?: Decimalish
  reorderLevel?: Decimalish
  batches?: BatchRecord[]
  isTracked?: boolean
  isBillable?: boolean
  isActive?: boolean
}

const toBatch = (batch: BatchRecord): StoredBatch => ({
  id: batch._id,
  batchNumber: batch.batchNumber ?? null,
  expiresAt: batch.expiresAt ?? null,
  quantity: asQuantity(batch.quantity),
  costPrice: decimal(batch.costPrice),
  receivedAt: batch.receivedAt ?? null,
})

const toItem = (doc: ItemRecord): StoredItem => ({
  id: doc._id,
  sku: doc.sku,
  name: doc.name,
  description: doc.description ?? null,
  categoryId: doc.categoryId ?? null,
  supplierId: doc.supplierId ?? null,
  unit: doc.unit,
  costPrice: decimal(doc.costPrice),
  salePrice: decimal(doc.salePrice),
  quantityOnHand: asQuantity(doc.quantityOnHand),
  reorderLevel: asQuantity(doc.reorderLevel),
  batches: (doc.batches ?? []).map(toBatch),
  isTracked: doc.isTracked ?? true,
  isBillable: doc.isBillable ?? true,
  isActive: doc.isActive ?? true,
})

export interface ItemFilter {
  q?: string
  categoryId?: string
  status?: 'active' | 'inactive' | 'all'
}

/** By the folded name, the id breaking ties between two items of the same name. */
const ITEM_ORDER: readonly SortKey[] = [
  { field: 'search.name', direction: 1, kind: 'string' },
  { field: '_id', direction: 1, kind: 'string' },
]

function itemFilter(clinicId: string, filter: ItemFilter): Record<string, unknown> {
  const query: Record<string, unknown> = { clinicId }
  if (filter.categoryId) query.categoryId = filter.categoryId
  if (filter.status && filter.status !== 'all') query.isActive = filter.status === 'active'
  if (filter.q) {
    // The folded keys, so "x-ray" finds "X-Ray" and a SKU search needs no separate box.
    const pattern = new RegExp(escapeRegExp(filter.q), 'i')
    query.$or = [{ 'search.name': pattern }, { 'search.sku': pattern }]
  }
  return query
}

export const itemRepository = {
  async create(clinicId: string, input: ItemWrite): Promise<StoredItem> {
    const doc = await InventoryItemModel().create({
      _id: newId(),
      clinicId,
      ...input,
      quantityOnHand: '0',
      batches: [],
    })
    return toItem(doc.toObject() as ItemRecord)
  },

  /**
   * Editing what an item *is*. Never what it holds: the quantity is the ledger's projection and
   * only the movement paths below may touch it, which is why the caller cannot pass one.
   */
  async update(clinicId: string, itemId: string, input: ItemWrite): Promise<StoredItem | null> {
    const doc = await InventoryItemModel().findOne({ clinicId, _id: itemId })
    if (!doc) return null
    for (const [key, value] of Object.entries(input)) doc.set(key, value)
    await doc.save()
    return toItem(doc.toObject() as ItemRecord)
  },

  async findById(clinicId: string, itemId: string): Promise<StoredItem | null> {
    const doc = (await InventoryItemModel()
      .findOne({ clinicId, _id: itemId })
      .lean()) as ItemRecord | null
    return doc ? toItem(doc) : null
  },

  async findMany(clinicId: string, itemIds: string[]): Promise<StoredItem[]> {
    if (itemIds.length === 0) return []
    const docs = (await InventoryItemModel()
      .find({ clinicId, _id: { $in: itemIds } })
      .lean()) as ItemRecord[]
    return docs.map(toItem)
  },

  /** A page of the catalogue, by name. Before Phase 10: the first 300 names, and nothing said. */
  async list(
    clinicId: string,
    filter: ItemFilter,
    page: { cursor?: string; limit: number },
  ): Promise<Page<StoredItem>> {
    const query = itemFilter(clinicId, filter)
    if (page.cursor) {
      query.$and = [keysetAfter(ITEM_ORDER, decodeCursor(page.cursor, ITEM_ORDER.length))]
    }
    const docs = (await InventoryItemModel()
      .find(query)
      .sort(sortFor(ITEM_ORDER))
      .limit(page.limit + 1)
      .lean()) as unknown as Array<ItemRecord & Record<string, unknown>>
    const { docs: rows, nextCursor } = pageFrom(docs, page.limit, ITEM_ORDER)
    return { items: rows.map(toItem), nextCursor }
  },

  /**
   * The whole catalogue matching a filter, for a question that has to see all of it: which items
   * are running low, which are about to expire. The first version read these through the same
   * 300-row cap as the screen — so the 301st item by name could run out without an alert.
   */
  async listAll(clinicId: string, filter: ItemFilter): Promise<StoredItem[]> {
    const docs = (await InventoryItemModel()
      .find(itemFilter(clinicId, filter))
      .sort(sortFor(ITEM_ORDER))
      .lean()) as ItemRecord[]
    return docs.map(toItem)
  },

  /**
   * Stock coming in. A delivery of a batch number the item already holds, with the same expiry,
   * tops that batch up rather than adding a second row — which is what keeps the embedded array
   * bounded and honest about the rule in section 8.2.
   *
   * Returns the batch the stock landed in, and the item's new total.
   */
  async receive(
    clinicId: string,
    itemId: string,
    incoming: {
      quantity: string
      batchNumber: string | null
      expiresAt: string | null
      costPrice: string | null
      receivedAt: Date
    },
    tx?: Transaction,
  ): Promise<{ batchId: string; batchNumber: string | null; balanceAfter: string } | null> {
    const quantity = decimal128(incoming.quantity)
    const session = sessionOf(tx)

    if (incoming.batchNumber !== null) {
      const merged = (await InventoryItemModel()
        .findOneAndUpdate(
          {
            clinicId,
            _id: itemId,
            batches: {
              $elemMatch: { batchNumber: incoming.batchNumber, expiresAt: incoming.expiresAt },
            },
          },
          {
            $inc: { quantityOnHand: quantity, 'batches.$[b].quantity': quantity },
            $set: { 'batches.$[b].receivedAt': incoming.receivedAt },
          },
          {
            new: true,
            session,
            arrayFilters: [
              { 'b.batchNumber': incoming.batchNumber, 'b.expiresAt': incoming.expiresAt },
            ],
          },
        )
        .lean()) as ItemRecord | null

      if (merged) {
        const batch = (merged.batches ?? []).find(
          (candidate) =>
            (candidate.batchNumber ?? null) === incoming.batchNumber &&
            (candidate.expiresAt ?? null) === incoming.expiresAt,
        )
        return {
          batchId: batch?._id ?? '',
          batchNumber: incoming.batchNumber,
          balanceAfter: asQuantity(merged.quantityOnHand),
        }
      }
    }

    const batchId = newId()
    const created = (await InventoryItemModel()
      .findOneAndUpdate(
        { clinicId, _id: itemId },
        {
          $inc: { quantityOnHand: quantity },
          $push: {
            batches: {
              _id: batchId,
              batchNumber: incoming.batchNumber,
              expiresAt: incoming.expiresAt,
              quantity: quantity,
              costPrice: incoming.costPrice,
              receivedAt: incoming.receivedAt,
            },
          },
        },
        { new: true, session },
      )
      .lean()) as ItemRecord | null

    if (!created) return null
    return {
      batchId,
      batchNumber: incoming.batchNumber,
      balanceAfter: asQuantity(created.quantityOnHand),
    }
  },

  /**
   * Stock going out — **the write this whole design exists for** (section 8.11).
   *
   * The item's total and every batch it comes from move in one update whose filter asserts each
   * has enough. Because the batches are embedded, MongoDB's document-level concurrency control
   * means the precondition and the decrement cannot be separated by another writer: there is no
   * read-then-write and no window to oversell through. Relationally this needed a row lock on the
   * item and a second write to a batch table.
   *
   * Null means the preconditions no longer hold — somebody else took the stock first.
   */
  async withdraw(
    clinicId: string,
    itemId: string,
    allocations: BatchAllocation[],
    total: string,
    tx?: Transaction,
  ): Promise<{ balanceAfter: string } | null> {
    const decrements: Record<string, unknown> = {
      quantityOnHand: decimal128(negateQuantity(total)),
    }
    const guards: Array<Record<string, unknown>> = []
    const arrayFilters: Array<Record<string, unknown>> = []

    allocations.forEach((allocation, index) => {
      const alias = `b${index}`
      decrements[`batches.$[${alias}].quantity`] = decimal128(negateQuantity(allocation.quantity))
      arrayFilters.push({ [`${alias}._id`]: allocation.batchId })
      guards.push({
        batches: {
          $elemMatch: {
            _id: allocation.batchId,
            quantity: { $gte: decimal128(allocation.quantity) },
          },
        },
      })
    })

    const doc = (await InventoryItemModel()
      .findOneAndUpdate(
        {
          clinicId,
          _id: itemId,
          // The preconditions, in the filter — never in a prior read.
          quantityOnHand: { $gte: decimal128(total) },
          ...(guards.length > 0 ? { $and: guards } : {}),
        },
        { $inc: decrements },
        { new: true, session: sessionOf(tx), arrayFilters },
      )
      .lean()) as ItemRecord | null

    return doc ? { balanceAfter: asQuantity(doc.quantityOnHand) } : null
  },

  /**
   * A correction to the item's total that belongs to no batch — a recount, or stock of an
   * untracked item. Positive or negative; the filter refuses to drive the total below zero.
   */
  async adjustTotal(
    clinicId: string,
    itemId: string,
    delta: string,
    tx?: Transaction,
  ): Promise<{ balanceAfter: string } | null> {
    const negative = delta.startsWith('-')
    const doc = (await InventoryItemModel()
      .findOneAndUpdate(
        {
          clinicId,
          _id: itemId,
          ...(negative ? { quantityOnHand: { $gte: decimal128(delta.slice(1)) } } : {}),
        },
        { $inc: { quantityOnHand: decimal128(delta) } },
        { new: true, session: sessionOf(tx) },
      )
      .lean()) as ItemRecord | null

    return doc ? { balanceAfter: asQuantity(doc.quantityOnHand) } : null
  },

  /** Drops batches that hold nothing, so the embedded array stays bounded (section 8.2). */
  async pruneEmptyBatches(clinicId: string, itemId: string, tx?: Transaction): Promise<void> {
    await InventoryItemModel().updateOne(
      { clinicId, _id: itemId },
      { $pull: { batches: { quantity: { $lte: decimal128('0') } } } },
      { session: sessionOf(tx) },
    )
  },

  async softDelete(clinicId: string, itemId: string): Promise<boolean> {
    const result = await InventoryItemModel().updateOne(
      { clinicId, _id: itemId },
      { $set: { deletedAt: new Date(), isActive: false } },
    )
    return result.matchedCount > 0
  },
}

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
