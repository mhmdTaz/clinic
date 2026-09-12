import { Schema, type InferSchemaType, type Model } from 'mongoose'
import { STOCK_MOVEMENT_TYPES } from '@clinic/config'
import { idField } from '../id'
import { getConnection } from '../connection'
import { tenantGuard } from '../plugins/tenant-guard'
import { auditCapture } from '../plugins/audit-capture'

const PersonRefSchema = new Schema({ id: String, name: String }, { _id: false })

/**
 * Why stock moved (section 8.11). **This is the truth**; `inventoryItems.quantityOnHand` is its
 * projection, exactly as `refunds` is the truth behind `payments.refundedAmount`.
 *
 * Append-only: no soft delete, no edits. A movement recorded in error is corrected by another
 * movement in the opposite direction, with a reason, which is how a stock book works on paper
 * and what lets the ledger keep explaining the balance.
 *
 * `quantity` is signed — positive in, negative out — so the ledger simply sums, and nothing has
 * to remember which types add and which subtract. `balanceAfter` is the running total the
 * movement produced, so "explain this number" is one row rather than a replay of the history.
 * The item's name, SKU and unit are snapshotted because the report is read years later and an
 * item can be renamed.
 */
export const StockMovementSchema = new Schema(
  {
    _id: idField,
    clinicId: { type: String, required: true },
    branchId: { type: String, default: null },

    itemId: { type: String, required: true },
    item: {
      name: { type: String, required: true },
      sku: { type: String, required: true },
      unit: { type: String, required: true },
    },
    batchId: { type: String, default: null },
    batchNumber: { type: String, default: null },

    type: { type: String, enum: STOCK_MOVEMENT_TYPES, required: true },
    quantity: { type: Schema.Types.Decimal128, required: true },
    balanceAfter: { type: Schema.Types.Decimal128, required: true },

    reason: { type: String, default: null },
    /** The visit that used it, where there was one — which is what ties stock to care. */
    encounterId: { type: String, default: null },
    /** The bill the consumption reached, so "why was I charged for this" has one answer. */
    invoiceId: { type: String, default: null },
    /** A delivery note, a purchase order, whatever the clinic writes on the box. */
    reference: { type: String, default: null },

    occurredAt: { type: Date, default: Date.now },
    performedBy: { type: PersonRefSchema, default: null },
  },
  { timestamps: true, collection: 'stockMovements' },
)

StockMovementSchema.plugin(tenantGuard)
StockMovementSchema.plugin(auditCapture, { model: 'StockMovement' })

StockMovementSchema.index({ clinicId: 1, itemId: 1, occurredAt: -1 }) // one item's ledger
StockMovementSchema.index({ clinicId: 1, occurredAt: -1 }) // the day's movements
StockMovementSchema.index({ clinicId: 1, encounterId: 1 }, { sparse: true })
StockMovementSchema.index({ clinicId: 1, type: 1, occurredAt: -1 })

export type StockMovementDoc = InferSchemaType<typeof StockMovementSchema> & { _id: string }

export const StockMovementModel = (): Model<StockMovementDoc> =>
  getConnection().models.StockMovement ??
  getConnection().model<StockMovementDoc>('StockMovement', StockMovementSchema)
