import { Schema, type Model, type InferSchemaType } from 'mongoose'
import { nameKey } from '@clinic/config'
import { idField } from '../id'
import { getConnection } from '../connection'
import { tenantGuard } from '../plugins/tenant-guard'
import { searchKeys } from '../plugins/search-keys'
import { auditCapture } from '../plugins/audit-capture'

/**
 * The clinic's own vocabulary of specialties — a collection, never an enum (section 8.3).
 * Retired rather than deleted, so a doctor's history keeps its label.
 */
export const SpecialtySchema = new Schema(
  {
    _id: idField,
    clinicId: { type: String, required: true },
    name: { type: String, required: true, trim: true },
    search: { name: String },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, collection: 'specialties' },
)

SpecialtySchema.plugin(tenantGuard)
SpecialtySchema.plugin(searchKeys, { keys: { 'search.name': { from: 'name', key: nameKey } } })
SpecialtySchema.plugin(auditCapture, { model: 'Specialty', ignoredPaths: ['search'] })

// "Cardiology" and "cardiology " are one specialty: uniqueness is on the folded name.
SpecialtySchema.index({ clinicId: 1, 'search.name': 1 }, { unique: true })

export type SpecialtyDoc = InferSchemaType<typeof SpecialtySchema> & { _id: string }

export const SpecialtyModel = (): Model<SpecialtyDoc> =>
  getConnection().models.Specialty ??
  getConnection().model<SpecialtyDoc>('Specialty', SpecialtySchema)
