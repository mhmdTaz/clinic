import { Schema, type InferSchemaType, type Model } from 'mongoose'
import { CODE_SYSTEMS, ENCOUNTER_STATUSES, ENCOUNTER_TYPES, NOTE_STATUSES } from '@clinic/config'
import { idField } from '../id'
import { getConnection } from '../connection'
import { tenantGuard } from '../plugins/tenant-guard'
import { softDelete } from '../plugins/soft-delete'
import { auditCapture } from '../plugins/audit-capture'

const PersonRefSchema = new Schema({ id: String, name: String }, { _id: false })

/**
 * A visit (section 8.8). The clearest win for a document model: the note, the vitals and the
 * diagnoses have no meaning outside the visit, are always read with it, and are bounded by it.
 *
 * Signing is one atomic update of this document, so there is no window in which the note is
 * marked SIGNED while its content is still being written (ADR-0024). The repository writes it
 * as a conditional update — the precondition lives in the filter, never in a prior read.
 */
export const EncounterSchema = new Schema(
  {
    _id: idField,
    clinicId: { type: String, required: true },
    number: { type: String, required: true },

    patientId: { type: String, required: true },
    doctorId: { type: String, required: true },
    /** Null for a visit with no appointment behind it. */
    appointmentId: { type: String, default: null },

    patient: {
      name: { type: String, required: true },
      medicalRecordNo: { type: String, required: true },
      dateOfBirth: { type: String, default: null },
    },
    doctor: { name: { type: String, required: true } },

    encounterType: { type: String, enum: ENCOUNTER_TYPES, default: 'CONSULTATION' },
    chiefComplaint: { type: String, default: null },
    startedAt: { type: Date, default: Date.now },
    endedAt: { type: Date, default: null },
    status: { type: String, enum: ENCOUNTER_STATUSES, default: 'OPEN' },

    note: {
      subjective: { type: String, default: null },
      objective: { type: String, default: null },
      assessment: { type: String, default: null },
      plan: { type: String, default: null },
      /** Off by default: sharing clinical text with a patient is a decision (ADR-0025). */
      isPatientVisible: { type: Boolean, default: false },
      status: { type: String, enum: NOTE_STATUSES, default: 'DRAFT' },
      signedAt: { type: Date, default: null },
      signedBy: { type: PersonRefSchema, default: null },
      /** Hash of the note's content at the moment of signing; tamper evidence (11.5). */
      signatureHash: { type: String, default: null },
      addenda: [
        {
          _id: idField,
          body: { type: String, required: true },
          author: { type: PersonRefSchema, default: null },
          createdAt: { type: Date, default: Date.now },
        },
      ],
    },

    /**
     * Measurements are Decimal128, not floats: a clinician wrote "36.6" and the record should
     * give back "36.6". Blood pressure and rates are whole numbers by nature.
     */
    vitals: {
      heightCm: { type: Schema.Types.Decimal128, default: null },
      weightKg: { type: Schema.Types.Decimal128, default: null },
      temperatureC: { type: Schema.Types.Decimal128, default: null },
      systolicMmHg: { type: Number, default: null },
      diastolicMmHg: { type: Number, default: null },
      heartRateBpm: { type: Number, default: null },
      respiratoryRate: { type: Number, default: null },
      oxygenSaturation: { type: Number, default: null },
      bloodGlucose: { type: Schema.Types.Decimal128, default: null },
      recordedAt: { type: Date, default: null },
      recordedBy: { type: PersonRefSchema, default: null },
    },

    diagnoses: [
      {
        _id: idField,
        code: { type: String, required: true },
        codeSystem: { type: String, enum: CODE_SYSTEMS, default: 'ICD10' },
        description: { type: String, required: true },
        isPrimary: { type: Boolean, default: false },
        isChronic: { type: Boolean, default: false },
        notes: { type: String, default: null },
      },
    ],

    createdBy: { type: PersonRefSchema, default: null },
  },
  { timestamps: true, collection: 'encounters' },
)

EncounterSchema.plugin(tenantGuard)
EncounterSchema.plugin(softDelete)
// A chart is PHI: every read of one is on the record, not only every write (11.3).
EncounterSchema.plugin(auditCapture, {
  model: 'Encounter',
  phiRead: true,
  // The signature hash is derived from content that is already diffed; the addenda are
  // append-only and each carries its own author and time.
  ignoredPaths: ['note.signatureHash', 'note.addenda'],
})

EncounterSchema.index({ clinicId: 1, patientId: 1, startedAt: -1 }) // the chart timeline
EncounterSchema.index({ clinicId: 1, doctorId: 1, startedAt: -1 }) // "my patients", ASSIGNED
EncounterSchema.index({ clinicId: 1, startedAt: -1 })
EncounterSchema.index({ clinicId: 1, 'diagnoses.code': 1 }) // multikey: cohort by ICD-10
EncounterSchema.index({ clinicId: 1, appointmentId: 1 }, { sparse: true })
EncounterSchema.index({ clinicId: 1, number: 1 }, { unique: true })

export type EncounterDoc = InferSchemaType<typeof EncounterSchema> & { _id: string }

export const EncounterModel = (): Model<EncounterDoc> =>
  getConnection().models.Encounter ??
  getConnection().model<EncounterDoc>('Encounter', EncounterSchema)
