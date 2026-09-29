import { Schema, type InferSchemaType, type Model } from 'mongoose'
import { DENTAL_SCOPES, DENTAL_SYMBOLS } from '@clinic/config'
import { idField } from '../id'
import { getConnection } from '../connection'
import { tenantGuard } from '../plugins/tenant-guard'
import { auditCapture } from '../plugins/audit-capture'

/**
 * What can be charted on a tooth (Phase 11): the clinic's own list of treatments and findings,
 * each with the picture it draws. Like the price list it is the clinic's vocabulary, not an enum,
 * and a treatment is retired rather than deleted — records already charted keep a snapshot of it.
 *
 * `serviceId` is the bridge to billing. Phase 12 prices a treatment plan from it; until then it is
 * only stored.
 */
export const DentalTreatmentSchema = new Schema(
  {
    _id: idField,
    clinicId: { type: String, required: true },
    /** Short and stable, e.g. "CROWN_ZIRCONIA". What a quick-pick and an import refer to. */
    code: { type: String, required: true, trim: true, uppercase: true },
    name: { type: String, required: true, trim: true },
    symbol: { type: String, enum: DENTAL_SYMBOLS, required: true },
    scope: { type: String, enum: DENTAL_SCOPES, required: true },
    serviceId: { type: String, default: null },
    sortOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, collection: 'dental_treatments' },
)

DentalTreatmentSchema.plugin(tenantGuard)
DentalTreatmentSchema.plugin(auditCapture, { model: 'DentalTreatment' })

DentalTreatmentSchema.index({ clinicId: 1, code: 1 }, { unique: true })
DentalTreatmentSchema.index({ clinicId: 1, isActive: 1, sortOrder: 1 })

export type DentalTreatmentDoc = InferSchemaType<typeof DentalTreatmentSchema> & { _id: string }

export const DentalTreatmentModel = (): Model<DentalTreatmentDoc> =>
  getConnection().models.DentalTreatment ??
  getConnection().model<DentalTreatmentDoc>('DentalTreatment', DentalTreatmentSchema)
