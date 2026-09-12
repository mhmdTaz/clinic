import { Schema, type InferSchemaType, type Model } from 'mongoose'
import { nameKey } from '@clinic/config'
import { idField } from '../id'
import { getConnection } from '../connection'
import { tenantGuard } from '../plugins/tenant-guard'
import { softDelete } from '../plugins/soft-delete'
import { searchKeys } from '../plugins/search-keys'
import { auditCapture } from '../plugins/audit-capture'

/**
 * Something the clinic keeps on a shelf (section 8.11).
 *
 * **The batches are embedded, and that is the whole design.** Taking stock out has to decrement
 * the item's total and a specific batch together or not at all; with both in one document that
 * is a single update whose filter asserts there is enough of each, so the storage engine's
 * document-level concurrency control does the work a row lock and a second table did
 * relationally. No read-then-write, no transaction, no oversell.
 *
 * `quantityOnHand` is a projection of the `stockMovements` ledger, not an independent truth. The
 * ledger is what explains it, and every movement carries the balance it produced so an auditor
 * can follow the arithmetic without summing the whole history.
 */
export const InventoryItemSchema = new Schema(
  {
    _id: idField,
    clinicId: { type: String, required: true },
    branchId: { type: String, default: null },

    sku: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    search: { sku: String, name: String },
    description: { type: String, default: null },

    categoryId: { type: String, default: null },
    supplierId: { type: String, default: null },
    /** The clinic's own word for one of these: "box", "vial", "tablet". */
    unit: { type: String, required: true },

    costPrice: { type: Schema.Types.Decimal128, default: null },
    salePrice: { type: Schema.Types.Decimal128, default: null },

    /** The ledger's projection. Only ever moved by a conditional update (section 8.11). */
    quantityOnHand: { type: Schema.Types.Decimal128, default: '0' },
    /** At or below this, the item is low. Zero means never warn. */
    reorderLevel: { type: Schema.Types.Decimal128, default: '0' },

    batches: [
      {
        _id: idField,
        batchNumber: { type: String, default: null },
        /** A calendar date in the clinic's zone (ADR-0010) — stock expires on a day. */
        expiresAt: { type: String, default: null },
        quantity: { type: Schema.Types.Decimal128, required: true },
        costPrice: { type: Schema.Types.Decimal128, default: null },
        receivedAt: { type: Date, default: Date.now },
      },
    ],

    /** Off for something the clinic uses but does not count — tap water, paper towels. */
    isTracked: { type: Boolean, default: true },
    /** Off for something consumed but never charged for — gloves, gauze. */
    isBillable: { type: Boolean, default: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, collection: 'inventoryItems' },
)

InventoryItemSchema.plugin(tenantGuard)
InventoryItemSchema.plugin(softDelete)
InventoryItemSchema.plugin(searchKeys, {
  keys: {
    'search.sku': { from: 'sku', key: nameKey },
    'search.name': { from: 'name', key: nameKey },
  },
})
// Stock levels are not PHI, but who changed a count and when is exactly what a stock-take asks.
InventoryItemSchema.plugin(auditCapture, {
  model: 'InventoryItem',
  // The ledger is the record of every movement; diffing the projection as well would double it.
  ignoredPaths: ['search', 'quantityOnHand', 'batches'],
})

// A SKU is unique among the items that still exist; a deleted one releases its code.
InventoryItemSchema.index(
  { clinicId: 1, 'search.sku': 1 },
  { unique: true, partialFilterExpression: { deletedAt: null } },
)
InventoryItemSchema.index({ clinicId: 1, isActive: 1, 'search.name': 1 })
InventoryItemSchema.index({ clinicId: 1, quantityOnHand: 1 }) // the low-stock widget
InventoryItemSchema.index({ clinicId: 1, 'batches.expiresAt': 1 }) // the expiring-soon widget
InventoryItemSchema.index({ clinicId: 1, categoryId: 1 })

export type InventoryItemDoc = InferSchemaType<typeof InventoryItemSchema> & { _id: string }

export const InventoryItemModel = (): Model<InventoryItemDoc> =>
  getConnection().models.InventoryItem ??
  getConnection().model<InventoryItemDoc>('InventoryItem', InventoryItemSchema)
