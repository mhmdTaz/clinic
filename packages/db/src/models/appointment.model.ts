import { Schema, type Model, type InferSchemaType } from 'mongoose'
import { APPOINTMENT_SOURCES, APPOINTMENT_STATUSES } from '@clinic/config'
import { idField } from '../id'
import { getConnection } from '../connection'
import { tenantGuard } from '../plugins/tenant-guard'
import { softDelete } from '../plugins/soft-delete'
import { auditCapture } from '../plugins/audit-capture'

const PersonRefSchema = new Schema({ id: String, name: String }, { _id: false })

/**
 * An appointment (section 8.7).
 *
 * The ids are the truth; the embedded snapshots let a week view — some three hundred rows over
 * eight doctors — render from one indexed range query instead of a lookup per row. A snapshot is
 * display-only and never read back for a decision, and a past appointment keeps the name as it
 * was on the day, which is the medical record behaving correctly rather than drifting.
 */
export const AppointmentSchema = new Schema(
  {
    _id: idField,
    clinicId: { type: String, required: true },
    branchId: { type: String, default: null },
    number: { type: String, required: true },

    patientId: { type: String, required: true },
    doctorId: { type: String, required: true },

    patient: {
      name: { type: String, required: true },
      medicalRecordNo: { type: String, required: true },
      phone: { type: String, default: null },
    },
    doctor: { name: { type: String, required: true } },

    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
    durationMinutes: { type: Number, required: true },

    status: { type: String, enum: APPOINTMENT_STATUSES, default: 'SCHEDULED' },
    source: { type: String, enum: APPOINTMENT_SOURCES, default: 'STAFF' },
    reason: { type: String, default: null },
    /** Staff-only. Never sent to a patient portal response. */
    internalNote: { type: String, default: null },

    checkedInAt: { type: Date, default: null },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
    cancelledBy: { type: PersonRefSchema, default: null },
    cancelReason: { type: String, default: null },
    rescheduledToId: { type: String, default: null },

    /** The lifecycle trail, bounded at a handful of transitions. */
    statusHistory: [
      {
        _id: false,
        fromStatus: { type: String, default: null },
        toStatus: { type: String, required: true },
        reason: { type: String, default: null },
        changedBy: { type: PersonRefSchema, default: null },
        changedAt: { type: Date, default: Date.now },
      },
    ],

    createdBy: { type: PersonRefSchema, default: null },
  },
  { timestamps: true, collection: 'appointments' },
)

AppointmentSchema.plugin(tenantGuard)
AppointmentSchema.plugin(softDelete)
// statusHistory is ignored because it is itself the record of the change the entry describes.
AppointmentSchema.plugin(auditCapture, {
  model: 'Appointment',
  ignoredPaths: ['statusHistory'],
})

AppointmentSchema.index({ clinicId: 1, startsAt: 1 }) // day and week views
AppointmentSchema.index({ clinicId: 1, doctorId: 1, startsAt: 1 }) // a doctor's column, ASSIGNED
AppointmentSchema.index({ clinicId: 1, patientId: 1, startsAt: -1 }) // a patient's timeline
AppointmentSchema.index({ clinicId: 1, status: 1, startsAt: 1 }) // "today's no-shows"
AppointmentSchema.index({ clinicId: 1, number: 1 }, { unique: true })

export type AppointmentDoc = InferSchemaType<typeof AppointmentSchema> & { _id: string }

export const AppointmentModel = (): Model<AppointmentDoc> =>
  getConnection().models.Appointment ??
  getConnection().model<AppointmentDoc>('Appointment', AppointmentSchema)
