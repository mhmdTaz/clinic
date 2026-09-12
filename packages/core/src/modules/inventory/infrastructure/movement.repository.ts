import { StockMovementModel, newId } from '@clinic/db'
import { addQuantities } from '@clinic/contracts'
import type { StockMovementType } from '@clinic/config'
import type { PersonRef } from '@clinic/contracts'
import { sessionOf, type Transaction } from '../../../transaction'

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

  async list(clinicId: string, filter: MovementFilter, limit = 200): Promise<StoredMovement[]> {
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
    const docs = (await StockMovementModel()
      .find(query)
      .sort({ occurredAt: -1, _id: -1 })
      .limit(limit)
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
