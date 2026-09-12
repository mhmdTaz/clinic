import { Schema, type InferSchemaType, type Model } from 'mongoose'
import { nameKey } from '@clinic/config'
import { idField } from '../id'
import { getConnection } from '../connection'
import { tenantGuard } from '../plugins/tenant-guard'
import { searchKeys } from '../plugins/search-keys'
import { auditCapture } from '../plugins/audit-capture'

/**
 * How a clinic groups what it keeps on the shelf — "Consumables", "Vaccines", "Stationery".
 * Its own vocabulary, never an enum (section 8.3), and retired rather than deleted so an item
 * that was filed under it keeps its label.
 */
export const InventoryCategorySchema = new Schema(
  {
    _id: idField,
    clinicId: { type: String, required: true },
    name: { type: String, required: true, trim: true },
    search: { name: String },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, collection: 'inventoryCategories' },
)

InventoryCategorySchema.plugin(tenantGuard)
InventoryCategorySchema.plugin(searchKeys, {
  keys: { 'search.name': { from: 'name', key: nameKey } },
})
InventoryCategorySchema.plugin(auditCapture, {
  model: 'InventoryCategory',
  ignoredPaths: ['search'],
})

InventoryCategorySchema.index({ clinicId: 1, 'search.name': 1 }, { unique: true })

export type InventoryCategoryDoc = InferSchemaType<typeof InventoryCategorySchema> & {
  _id: string
}

export const InventoryCategoryModel = (): Model<InventoryCategoryDoc> =>
  getConnection().models.InventoryCategory ??
  getConnection().model<InventoryCategoryDoc>('InventoryCategory', InventoryCategorySchema)
