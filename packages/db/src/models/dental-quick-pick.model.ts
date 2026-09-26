import { Schema, type InferSchemaType, type Model } from 'mongoose'
import { TOOTH_RECORD_STATUSES, TOOTH_SURFACES } from '@clinic/config'
import { idField } from '../id'
import { getConnection } from '../connection'
import { tenantGuard } from '../plugins/tenant-guard'
import { auditCapture } from '../plugins/audit-capture'

/**
 * A one-tap preset for the tooth chart (Phase 11): "Composite MO", "Root canal and crown". The
 * front desk charts a visit in seconds by applying one to a tooth.
 *
 * A preset with a `doctorId` is that doctor's own; without one it is the clinic's. It holds
 * references to treatments, not copies — applying it snapshots each treatment as it stands then.
 */
export const DentalQuickPickSchema = new Schema(
  {
    _id: idField,
    clinicId: { type: String, required: true },
    doctorId: { type: String, default: null },
    name: { type: String, required: true, trim: true },
    items: [
      {
        _id: false,
        treatmentId: { type: String, required: true },
        surfaces: { type: [{ type: String, enum: TOOTH_SURFACES }], default: [] },
        status: { type: String, enum: TOOTH_RECORD_STATUSES, required: true },
      },
    ],
    sortOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, collection: 'dental_quick_picks' },
)

DentalQuickPickSchema.plugin(tenantGuard)
DentalQuickPickSchema.plugin(auditCapture, { model: 'DentalQuickPick' })

DentalQuickPickSchema.index({ clinicId: 1, isActive: 1, doctorId: 1, sortOrder: 1 })

export type DentalQuickPickDoc = InferSchemaType<typeof DentalQuickPickSchema> & { _id: string }

export const DentalQuickPickModel = (): Model<DentalQuickPickDoc> =>
  getConnection().models.DentalQuickPick ??
  getConnection().model<DentalQuickPickDoc>('DentalQuickPick', DentalQuickPickSchema)
