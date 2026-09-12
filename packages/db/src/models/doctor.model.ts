import { Schema, type Model, type InferSchemaType } from 'mongoose'
import { SLOT_MINUTE_OPTIONS } from '@clinic/config'
import { idField } from '../id'
import { getConnection } from '../connection'
import { tenantGuard } from '../plugins/tenant-guard'
import { softDelete } from '../plugins/soft-delete'
import { auditCapture } from '../plugins/audit-capture'

const PersonRefSchema = new Schema({ id: String, name: String }, { _id: false })

/**
 * A doctor's practice profile (section 8.6). The person — name, email, sign-in — is the User
 * it points to; this document holds what only a doctor has. Availability and time off join
 * in Phase 3, embedded, because slot computation reads them together on every calendar render.
 */
export const DoctorSchema = new Schema(
  {
    _id: idField,
    clinicId: { type: String, required: true },
    userId: { type: String, required: true },

    title: { type: String, default: null },
    licenseNumber: { type: String, default: null },
    bio: { type: String, default: null },
    yearsOfExperience: { type: Number, default: null, min: 0, max: 70 },
    /** Decimal128, never a double (section 8.3). Its currency is the clinic's. */
    consultationFee: { type: Schema.Types.Decimal128, default: null },
    defaultSlotMinutes: {
      type: Number,
      default: 30,
      validate: {
        validator: (value: number) => (SLOT_MINUTE_OPTIONS as readonly number[]).includes(value),
        message: 'defaultSlotMinutes must sit on the booking grid',
      },
    },

    // A reference and its display snapshot in one entry (section 8.3): the id is the truth and
    // drives the index, the name renders a card without a lookup. One array rather than two
    // parallel ones, so a rename is a single array-filter update that cannot misalign.
    specialties: [
      {
        _id: false,
        id: { type: String, required: true },
        name: { type: String, required: true },
      },
    ],
    branchIds: { type: [String], default: [] },

    /**
     * The week and the days away (section 8.7), embedded: slot computation reads them with the
     * profile on every calendar render, and both are small and bounded. Times are local to the
     * clinic (ADR-0010); time off is a calendar-date range, both ends inclusive.
     */
    availability: {
      type: [
        {
          _id: false,
          dayOfWeek: { type: Number, required: true, min: 0, max: 6 },
          startsAt: { type: String, required: true },
          endsAt: { type: String, required: true },
        },
      ],
      default: [],
    },
    timeOff: {
      type: [
        {
          _id: false,
          id: { type: String, required: true },
          startDate: { type: String, required: true },
          endDate: { type: String, required: true },
          reason: { type: String, default: null },
        },
      ],
      default: [],
    },

    isAcceptingNew: { type: Boolean, default: true },
    isActive: { type: Boolean, default: true },
    createdBy: { type: PersonRefSchema, default: null },
    updatedBy: { type: PersonRefSchema, default: null },
  },
  { timestamps: true, collection: 'doctors' },
)

DoctorSchema.plugin(tenantGuard)
DoctorSchema.plugin(softDelete)
DoctorSchema.plugin(auditCapture, { model: 'Doctor', ignoredPaths: ['updatedBy'] })

DoctorSchema.index({ clinicId: 1, isActive: 1 })
DoctorSchema.index(
  { clinicId: 1, userId: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null } },
)
DoctorSchema.index({ clinicId: 1, 'specialties.id': 1 }) // multikey: "find cardiologists"

export type DoctorDoc = InferSchemaType<typeof DoctorSchema> & { _id: string }

export const DoctorModel = (): Model<DoctorDoc> =>
  getConnection().models.Doctor ?? getConnection().model<DoctorDoc>('Doctor', DoctorSchema)
