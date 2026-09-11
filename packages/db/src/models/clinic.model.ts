import { Schema, type Model, type InferSchemaType } from 'mongoose'
import { idField } from '../id'
import { getConnection } from '../connection'
import { auditCapture } from '../plugins/audit-capture'

const WorkingHourSchema = new Schema(
  {
    dayOfWeek: { type: Number, min: 0, max: 6, required: true }, // 0 = Sunday
    opensAt: { type: String, required: true }, // "09:00", local to the branch
    closesAt: { type: String, required: true },
  },
  { _id: false },
)

const BranchSchema = new Schema({
  _id: idField,
  name: { type: String, required: true },
  phone: String,
  address: String,
  timezone: String, // falls back to the clinic timezone
  workingHours: [WorkingHourSchema],
  isActive: { type: Boolean, default: true },
})

/**
 * Branches, working hours and holidays are EMBEDDED (section 8.2): read together on
 * nearly every request, bounded at tens, never queried standalone. A branch's
 * subdocument _id is the stable string other collections reference as branchId.
 */
export const ClinicSchema = new Schema(
  {
    _id: idField,
    name: { type: String, required: true },
    legalName: String,
    taxId: String,
    logoFileId: String,
    contact: { email: String, phone: String },
    address: { line1: String, line2: String, city: String, country: String },
    timezone: { type: String, default: 'UTC' }, // IANA
    currency: { type: String, default: 'USD' }, // ISO-4217
    locale: { type: String, default: 'en' },

    branches: [BranchSchema],
    holidays: [{ _id: false, date: Date, name: String, branchId: String }],

    settings: { type: Schema.Types.Mixed, default: {} },
    featureFlags: { type: Map, of: Boolean, default: {} },

    permissionVersion: { type: Number, default: 1 }, // section 7.7
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, collection: 'clinics' },
)

// The clinic IS the tenant, so tenantGuard does not apply and the audit entry's
// clinic id is the document's own _id.
ClinicSchema.plugin(auditCapture, { model: 'Clinic', tenantField: '_id' })
ClinicSchema.index({ isActive: 1 })

export type ClinicDoc = InferSchemaType<typeof ClinicSchema> & { _id: string }

export const ClinicModel = (): Model<ClinicDoc> =>
  getConnection().models.Clinic ?? getConnection().model<ClinicDoc>('Clinic', ClinicSchema)
