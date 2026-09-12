import { Schema, type InferSchemaType, type Model } from 'mongoose'
import { nameKey } from '@clinic/config'
import { idField } from '../id'
import { getConnection } from '../connection'
import { tenantGuard } from '../plugins/tenant-guard'
import { searchKeys } from '../plugins/search-keys'
import { auditCapture } from '../plugins/audit-capture'

/**
 * The clinic's price list (section 8.10, A6). Like specialties, it is the clinic's own
 * vocabulary rather than an enum, and a service is retired rather than deleted: invoices
 * already issued keep pointing at it, and a deleted row would orphan them.
 *
 * The price is a snapshot source, not a reference. An invoice line copies the name, the price
 * and the tax rate at the moment it is drawn, so raising a fee tomorrow does not silently
 * restate what a patient was charged today.
 */
export const ServiceSchema = new Schema(
  {
    _id: idField,
    clinicId: { type: String, required: true },
    name: { type: String, required: true, trim: true },
    search: { name: String },
    description: { type: String, default: null },
    /** Decimal128, never a float: a price is money and money is exact (section 9.2). */
    price: { type: Schema.Types.Decimal128, required: true },
    taxRatePercent: { type: Schema.Types.Decimal128, default: '0' },
    /** What it usually takes; scheduling can offer it later without a second catalogue. */
    durationMinutes: { type: Number, default: null },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, collection: 'services' },
)

ServiceSchema.plugin(tenantGuard)
ServiceSchema.plugin(searchKeys, { keys: { 'search.name': { from: 'name', key: nameKey } } })
ServiceSchema.plugin(auditCapture, { model: 'Service', ignoredPaths: ['search'] })

// "Consultation" and "consultation " are one service: uniqueness is on the folded name.
ServiceSchema.index({ clinicId: 1, 'search.name': 1 }, { unique: true })
ServiceSchema.index({ clinicId: 1, isActive: 1, name: 1 })

export type ServiceDoc = InferSchemaType<typeof ServiceSchema> & { _id: string }

export const ServiceModel = (): Model<ServiceDoc> =>
  getConnection().models.Service ?? getConnection().model<ServiceDoc>('Service', ServiceSchema)
