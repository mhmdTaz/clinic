import { Schema, type Model, type InferSchemaType } from 'mongoose'
import { BLOOD_TYPES, GENDERS, emailKey, nameKey, nationalIdKey, phoneKey } from '@clinic/config'
import { idField } from '../id'
import { getConnection } from '../connection'
import { tenantGuard } from '../plugins/tenant-guard'
import { softDelete } from '../plugins/soft-delete'
import { searchKeys } from '../plugins/search-keys'
import { auditCapture } from '../plugins/audit-capture'

const PersonRefSchema = new Schema({ id: String, name: String }, { _id: false })

/**
 * A patient's administrative record (section 8.6). Clinical history — allergies, chronic
 * conditions, insurances — joins in Phase 4 as embedded arrays, which needs no migration.
 *
 * `dateOfBirth` is a calendar date, "1990-04-17", never a Date: stored as midnight UTC, a
 * birthday renders as the day before anywhere west of Greenwich.
 */
export const PatientSchema = new Schema(
  {
    _id: idField,
    clinicId: { type: String, required: true },
    /** The portal account, once the patient has been invited (ADR-0006). */
    userId: { type: String, default: null },
    medicalRecordNo: { type: String, required: true },

    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    dateOfBirth: { type: String, default: null },
    gender: { type: String, enum: GENDERS, default: null },
    nationalId: { type: String, default: null },
    bloodType: { type: String, enum: BLOOD_TYPES, default: 'UNKNOWN' },
    contact: {
      phone: { type: String, default: null },
      email: { type: String, default: null },
    },
    address: {
      line1: { type: String, default: null },
      city: { type: String, default: null },
      country: { type: String, default: null },
    },

    // Bounded at five and needed wherever the record is open, so embedded (section 8.2).
    emergencyContacts: [
      {
        _id: false,
        name: { type: String, required: true },
        relationship: { type: String, default: null },
        phone: { type: String, required: true },
      },
    ],
    /** Administrative notes — scheduling preferences, billing remarks — never clinical. */
    adminNotes: { type: String, default: null },

    // Folded copies for search and duplicate matching, kept current by searchKeys.
    search: {
      firstName: String,
      lastName: String,
      phone: String,
      email: String,
      nationalId: String,
    },

    isActive: { type: Boolean, default: true },
    createdBy: { type: PersonRefSchema, default: null },
    updatedBy: { type: PersonRefSchema, default: null },
  },
  { timestamps: true, collection: 'patients' },
)

PatientSchema.plugin(tenantGuard)
PatientSchema.plugin(softDelete)
PatientSchema.plugin(searchKeys, {
  keys: {
    'search.firstName': { from: 'firstName', key: nameKey },
    'search.lastName': { from: 'lastName', key: nameKey },
    'search.phone': { from: 'contact.phone', key: phoneKey },
    'search.email': { from: 'contact.email', key: emailKey },
    'search.nationalId': { from: 'nationalId', key: nationalIdKey },
  },
})
PatientSchema.plugin(auditCapture, {
  model: 'Patient',
  // Every read of a patient record is on the record (section 11.3).
  phiRead: true,
  sensitivePaths: ['nationalId', 'adminNotes'],
  ignoredPaths: ['search', 'updatedBy'],
})

PatientSchema.index(
  { clinicId: 1, medicalRecordNo: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null } },
)
// Serves the directory's name order, prefix search on the last name, and name + birth date
// duplicate matching — all three lead with the same keys.
PatientSchema.index({ clinicId: 1, 'search.lastName': 1, 'search.firstName': 1, dateOfBirth: 1 })
PatientSchema.index({ clinicId: 1, 'search.firstName': 1 })
PatientSchema.index({ clinicId: 1, 'search.phone': 1 })
PatientSchema.index({ clinicId: 1, 'search.nationalId': 1 })
PatientSchema.index({ clinicId: 1, 'search.email': 1 })
// Lookups by portal account ("my record"), and — keys reversed, because MongoDB allows one
// index per key pattern — the rule that an account belongs to at most one patient.
PatientSchema.index({ clinicId: 1, userId: 1 })
PatientSchema.index(
  { userId: 1, clinicId: 1 },
  { unique: true, partialFilterExpression: { userId: { $type: 'string' }, deletedAt: null } },
)

export type PatientDoc = InferSchemaType<typeof PatientSchema> & { _id: string }

export const PatientModel = (): Model<PatientDoc> =>
  getConnection().models.Patient ?? getConnection().model<PatientDoc>('Patient', PatientSchema)
