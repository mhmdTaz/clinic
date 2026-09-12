import { Schema, type InferSchemaType, type Model } from 'mongoose'
import { nameKey } from '@clinic/config'
import { idField } from '../id'
import { getConnection } from '../connection'
import { tenantGuard } from '../plugins/tenant-guard'
import { searchKeys } from '../plugins/search-keys'
import { auditCapture } from '../plugins/audit-capture'

/**
 * Who the clinic buys from (section 8.11). Retired rather than deleted: a stock receipt from
 * two years ago still names them, and a deleted row would orphan it.
 */
export const SupplierSchema = new Schema(
  {
    _id: idField,
    clinicId: { type: String, required: true },
    name: { type: String, required: true, trim: true },
    search: { name: String },
    contactName: { type: String, default: null },
    phone: { type: String, default: null },
    email: { type: String, default: null },
    notes: { type: String, default: null },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, collection: 'suppliers' },
)

SupplierSchema.plugin(tenantGuard)
SupplierSchema.plugin(searchKeys, { keys: { 'search.name': { from: 'name', key: nameKey } } })
SupplierSchema.plugin(auditCapture, { model: 'Supplier', ignoredPaths: ['search'] })

SupplierSchema.index({ clinicId: 1, 'search.name': 1 }, { unique: true })

export type SupplierDoc = InferSchemaType<typeof SupplierSchema> & { _id: string }

export const SupplierModel = (): Model<SupplierDoc> =>
  getConnection().models.Supplier ?? getConnection().model<SupplierDoc>('Supplier', SupplierSchema)
