import { StockMovementModel, newId } from '@clinic/db'
import { addQuantities } from '@clinic/contracts'
import type { StockMovementType } from '@clinic/config'
import type { PersonRef } from '@clinic/contracts'
import { sessionOf, type Transaction } from '../../../transaction'
import {
  decodeCursor,
  keysetAfter,
  pageFrom,
  sortFor,
  type Page,
  type SortKey,
} from '../../../pagination'

/** Mongoose hands back a Decimal128; a quantity leaves this file as the decimal string it is. */
type Decimalish = { toString(): string } | string | number | null | undefined

const decimal = (value: Decimalish, fallback = '0'): string =>
  value === null || value === undefined ? fallback : String(value)

/** Three places, always — see the note in the item repository. */
const asQuantity = (value: Decimalish): string => addQuantities(decimal(value))

export interface StoredMovement {
  id: string
  itemId: string
  item: { name: string; sku: string; unit: string }
  batchId: string | null
  batchNumber: string | null
  type: StockMovementType
  quantity: string
  balanceAfter: string
  reason: string | null
  encounterId: string | null
  invoiceId: string | null
  reference: string | null
  occurredAt: Date
  performedBy: PersonRef | null
}

export interface MovementWrite {
  clinicId: string
  itemId: string
  item: { name: string; sku: string; unit: string }
  batchId: string | null
  batchNumber: string | null
  type: StockMovementType
  quantity: string
  balanceAfter: string
  reason: string | null
  encounterId: string | null
  invoiceId: string | null
  reference: string | null
  occurredAt: Date
  performedBy: PersonRef
}

interface MovementRecord {
  _id: string
  itemId: string
  item?: { name?: string; sku?: string; unit?: string } | null
  batchId?: string | null
  batchNumber?: string | null
  type: StockMovementType
  quantity?: Decimalish
  balanceAfter?: Decimalish
  reason?: string | null
  encounterId?: string | null
  invoiceId?: string | null
  reference?: string | null
  occurredAt?: Date | null
  performedBy?: PersonRef | null
}

const toMovement = (doc: MovementRecord): StoredMovement => ({
  id: doc._id,
  itemId: doc.itemId,
  item: {
    name: doc.item?.name ?? '',
    sku: doc.item?.sku ?? '',
    unit: doc.item?.unit ?? '',
  },
  batchId: doc.batchId ?? null,
  batchNumber: doc.batchNumber ?? null,
  type: doc.type,
  quantity: asQuantity(doc.quantity),
  balanceAfter: asQuantity(doc.balanceAfter),
  reason: doc.reason ?? null,
  encounterId: doc.encounterId ?? null,
  invoiceId: doc.invoiceId ?? null,
  reference: doc.reference ?? null,
  occurredAt: doc.occurredAt ?? new Date(0),
  performedBy: doc.performedBy ?? null,
})

export interface MovementFilter {
  itemId?: string
  encounterId?: string
  type?: StockMovementType
  from?: Date
  to?: Date
}

const MOVEMENT_ORDER: readonly SortKey[] = [
  { field: 'occurredAt', direction: -1, kind: 'date' },
  { field: '_id', direction: -1, kind: 'string' },
]

function movementFilter(clinicId: string, filter: MovementFilter): Record<string, unknown> {
  const query: Record<string, unknown> = { clinicId }
  if (filter.itemId) query.itemId = filter.itemId
  if (filter.encounterId) query.encounterId = filter.encounterId
  if (filter.type) query.type = filter.type
  if (filter.from || filter.to) {
    const range: Record<string, Date> = {}
    if (filter.from) range.$gte = filter.from
    if (filter.to) range.$lt = filter.to
    query.occurredAt = range
  }
  return query
}

export const movementRepository = {
  /**
   * The ledger is append-only: rows are written, never edited or removed. A movement recorded in
   * error is corrected by another movement in the opposite direction, which is how a stock book
   * works on paper and what lets the ledger keep explaining the balance.
   */
  async record(entries: MovementWrite[], tx?: Transaction): Promise<StoredMovement[]> {
    if (entries.length === 0) return []
    const docs = await StockMovementModel().create(
      entries.map((entry) => ({ _id: newId(), ...entry })),
      { session: sessionOf(tx), ordered: true },
    )
    return docs.map((doc) => toMovement(doc.toObject() as MovementRecord))
  },

  /** A page of the ledger, newest first. Before Phase 10: the newest 200, and nothing said. */
  async list(
    clinicId: string,
    filter: MovementFilter,
    page: { cursor?: string; limit: number },
  ): Promise<Page<StoredMovement>> {
    const query = movementFilter(clinicId, filter)
    if (page.cursor) {
      query.$and = [keysetAfter(MOVEMENT_ORDER, decodeCursor(page.cursor, MOVEMENT_ORDER.length))]
    }
    const docs = (await StockMovementModel()
      .find(query)
      .sort(sortFor(MOVEMENT_ORDER))
      .limit(page.limit + 1)
      .lean()) as unknown as Array<MovementRecord & Record<string, unknown>>
    const { docs: rows, nextCursor } = pageFrom(docs, page.limit, MOVEMENT_ORDER)
    return { items: rows.map(toMovement), nextCursor }
  },

  /**
   * Every movement matching a filter that bounds itself — one visit's consumption. No page and no
   * cap, because a cap is exactly the silent truncation Phase 10 removed.
   */
  async listAllFor(
    clinicId: string,
    filter: MovementFilter & { encounterId: string },
  ): Promise<StoredMovement[]> {
    const docs = (await StockMovementModel()
      .find(movementFilter(clinicId, filter))
      .sort(sortFor(MOVEMENT_ORDER))
      .lean()) as MovementRecord[]
    return docs.map(toMovement)
  },

  /** What the ledger says an item holds — the projection's own audit (section 8.11). */
  async sumFor(clinicId: string, itemId: string): Promise<string> {
    const [row] = (await StockMovementModel().aggregate([
      { $match: { clinicId, itemId } },
      { $group: { _id: null, total: { $sum: '$quantity' } } },
    ])) as Array<{ total: Decimalish }>
    return asQuantity(row?.total)
  },
}
