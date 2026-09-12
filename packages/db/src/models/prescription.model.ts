import { Schema, type InferSchemaType, type Model } from 'mongoose'
import { idField } from '../id'
import { getConnection } from '../connection'
import { tenantGuard } from '../plugins/tenant-guard'
import { softDelete } from '../plugins/soft-delete'
import { auditCapture } from '../plugins/audit-capture'

const PersonRefSchema = new Schema({ id: String, name: String }, { _id: false })

/**
 * A prescription (section 8.8). Its own collection, not embedded in the encounter: it is read
 * on its own — the pharmacy's copy, a patient's current medications — and outlives the visit.
 *
 * The items are embedded because they are bounded and meaningless apart from the prescription.
 * The doctor's name and licence number are snapshotted because they are printed on the PDF, and
 * the document must keep saying what it said on the day it was issued.
 */
export const PrescriptionSchema = new Schema(
  {
    _id: idField,
    clinicId: { type: String, required: true },
    number: { type: String, required: true },

    encounterId: { type: String, required: true },
    patientId: { type: String, required: true },
    doctorId: { type: String, required: true },

    patient: {
      name: { type: String, required: true },
      medicalRecordNo: { type: String, required: true },
    },
    doctor: {
      name: { type: String, required: true },
      licenseNumber: { type: String, default: null },
    },

    issuedAt: { type: Date, default: Date.now },
    /** A calendar date in the clinic's zone (ADR-0010), not an instant. */
    validUntil: { type: String, default: null },
    notes: { type: String, default: null },

    items: [
      {
        _id: idField,
        drugName: { type: String, required: true },
        strength: { type: String, default: null },
        form: { type: String, default: null },
        dosage: { type: String, required: true },
        frequency: { type: String, required: true },
        durationDays: { type: Number, default: null },
        quantity: { type: Number, default: null },
        instructions: { type: String, default: null },
        isRefillable: { type: Boolean, default: false },
      },
    ],

    /** Null until the PDF has been rendered and stored (ADR-0026). */
    pdfFileId: { type: String, default: null },
    issuedBy: { type: PersonRefSchema, default: null },
  },
  { timestamps: true, collection: 'prescriptions' },
)

PrescriptionSchema.plugin(tenantGuard)
PrescriptionSchema.plugin(softDelete)
PrescriptionSchema.plugin(auditCapture, {
  model: 'Prescription',
  phiRead: true,
  // Rendering the PDF is not a change to what was prescribed.
  ignoredPaths: ['pdfFileId'],
})

PrescriptionSchema.index({ clinicId: 1, patientId: 1, issuedAt: -1 })
PrescriptionSchema.index({ clinicId: 1, encounterId: 1 })
PrescriptionSchema.index({ clinicId: 1, patientId: 1, validUntil: -1 }) // "active medications"
PrescriptionSchema.index({ clinicId: 1, number: 1 }, { unique: true })

export type PrescriptionDoc = InferSchemaType<typeof PrescriptionSchema> & { _id: string }

export const PrescriptionModel = (): Model<PrescriptionDoc> =>
  getConnection().models.Prescription ??
  getConnection().model<PrescriptionDoc>('Prescription', PrescriptionSchema)
