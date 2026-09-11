import { AppointmentModel, SlotReservationModel, newId, nextFormatted } from '@clinic/db'
import type { AppointmentSource, AppointmentStatus } from '@clinic/config'
import type { PersonRef } from '@clinic/contracts'
import { sessionOf, type Transaction } from '../../../transaction'
import { SLOT_HOLDING_STATUSES } from '../domain/status'

export interface StoredStatusChange {
  fromStatus: AppointmentStatus | null
  toStatus: AppointmentStatus
  reason: string | null
  changedBy: PersonRef | null
  changedAt: Date
}

export interface StoredAppointment {
  id: string
  number: string
  branchId: string | null
  patientId: string
  doctorId: string
  patient: { name: string; medicalRecordNo: string; phone: string | null }
  doctor: { name: string }
  startsAt: Date
  endsAt: Date
  durationMinutes: number
  status: AppointmentStatus
  source: AppointmentSource
  reason: string | null
  internalNote: string | null
  checkedInAt: Date | null
  startedAt: Date | null
  completedAt: Date | null
  cancelledAt: Date | null
  cancelledBy: PersonRef | null
  cancelReason: string | null
  rescheduledToId: string | null
  statusHistory: StoredStatusChange[]
  createdAt: Date | null
  createdBy: PersonRef | null
}

export interface AppointmentWrite {
  clinicId: string
  branchId: string | null
  number: string
  patientId: string
  doctorId: string
  patient: { name: string; medicalRecordNo: string; phone: string | null }
  doctor: { name: string }
  startsAt: Date
  endsAt: Date
  durationMinutes: number
  source: AppointmentSource
  reason: string | null
  internalNote: string | null
  createdBy: PersonRef
}

interface AppointmentRecord {
  _id: string
  number: string
  branchId?: string | null
  patientId: string
  doctorId: string
  patient?: { name?: string; medicalRecordNo?: string; phone?: string | null } | null
  doctor?: { name?: string } | null
  startsAt: Date
  endsAt: Date
  durationMinutes?: number | null
  status?: AppointmentStatus | null
  source?: AppointmentSource | null
  reason?: string | null
  internalNote?: string | null
  checkedInAt?: Date | null
  startedAt?: Date | null
  completedAt?: Date | null
  cancelledAt?: Date | null
  cancelledBy?: PersonRef | null
  cancelReason?: string | null
  rescheduledToId?: string | null
  statusHistory?: Array<{
    fromStatus?: AppointmentStatus | null
    toStatus: AppointmentStatus
    reason?: string | null
    changedBy?: PersonRef | null
    changedAt?: Date | null
  }> | null
  createdAt?: Date | null
  createdBy?: PersonRef | null
}

function toAppointment(doc: AppointmentRecord): StoredAppointment {
  return {
    id: doc._id,
    number: doc.number,
    branchId: doc.branchId ?? null,
    patientId: doc.patientId,
    doctorId: doc.doctorId,
    patient: {
      name: doc.patient?.name ?? '',
      medicalRecordNo: doc.patient?.medicalRecordNo ?? '',
      phone: doc.patient?.phone ?? null,
    },
    doctor: { name: doc.doctor?.name ?? '' },
    startsAt: doc.startsAt,
    endsAt: doc.endsAt,
    durationMinutes: doc.durationMinutes ?? 0,
    status: doc.status ?? 'SCHEDULED',
    source: doc.source ?? 'STAFF',
    reason: doc.reason ?? null,
    internalNote: doc.internalNote ?? null,
    checkedInAt: doc.checkedInAt ?? null,
    startedAt: doc.startedAt ?? null,
    completedAt: doc.completedAt ?? null,
    cancelledAt: doc.cancelledAt ?? null,
    cancelledBy: doc.cancelledBy ?? null,
    cancelReason: doc.cancelReason ?? null,
    rescheduledToId: doc.rescheduledToId ?? null,
    statusHistory: (doc.statusHistory ?? []).map((entry) => ({
      fromStatus: entry.fromStatus ?? null,
      toStatus: entry.toStatus,
      reason: entry.reason ?? null,
      changedBy: entry.changedBy ?? null,
      changedAt: entry.changedAt ?? new Date(0),
    })),
    createdAt: doc.createdAt ?? null,
    createdBy: doc.createdBy ?? null,
  }
}

/** A booking race, settled by the storage engine on the reservation `_id` (ADR-0013). */
export const isSlotTaken = (error: unknown) => (error as { code?: unknown } | null)?.code === 11000

/** A calendar asks for a day or a week; the ceiling is a guard, not a page size. */
const CALENDAR_LIMIT = 2000

export const appointmentRepository = {
  nextNumber(clinicId: string): Promise<string> {
    return nextFormatted(`apt:${clinicId}`, 'APT', 6)
  },

  async create(input: AppointmentWrite, tx?: Transaction): Promise<StoredAppointment> {
    const [doc] = await AppointmentModel().create(
      [
        {
          _id: newId(),
          ...input,
          status: 'SCHEDULED',
          statusHistory: [
            {
              fromStatus: null,
              toStatus: 'SCHEDULED',
              reason: null,
              changedBy: input.createdBy,
              changedAt: new Date(),
            },
          ],
          deletedAt: null,
        },
      ],
      { session: sessionOf(tx) },
    )
    if (!doc) throw new Error('The appointment document was not created')
    return toAppointment(doc.toObject() as unknown as AppointmentRecord)
  },

  async findById(clinicId: string, appointmentId: string): Promise<StoredAppointment | null> {
    const doc = await AppointmentModel().findOne({ clinicId, _id: appointmentId }).lean()
    return doc ? toAppointment(doc as unknown as AppointmentRecord) : null
  },

  async list(
    clinicId: string,
    filter: {
      from: Date
      to: Date
      doctorId?: string
      patientId?: string
      status?: AppointmentStatus
      branchId?: string
    },
  ): Promise<StoredAppointment[]> {
    const where: Record<string, unknown> = {
      clinicId,
      startsAt: { $gte: filter.from, $lt: filter.to },
    }
    if (filter.doctorId) where.doctorId = filter.doctorId
    if (filter.patientId) where.patientId = filter.patientId
    if (filter.status) where.status = filter.status
    if (filter.branchId) where.branchId = filter.branchId

    const docs = await AppointmentModel()
      .find(where)
      .sort({ startsAt: 1 })
      .limit(CALENDAR_LIMIT)
      .lean()
    return (docs as unknown as AppointmentRecord[]).map(toAppointment)
  },

  /** The time a doctor is already committed to. Cancelled and no-show appointments are free. */
  async busyRanges(
    clinicId: string,
    doctorId: string,
    from: Date,
    to: Date,
    exceptAppointmentId?: string,
  ): Promise<Array<{ startsAt: Date; endsAt: Date }>> {
    const where: Record<string, unknown> = {
      clinicId,
      doctorId,
      status: { $in: SLOT_HOLDING_STATUSES },
      startsAt: { $lt: to },
      endsAt: { $gt: from },
    }
    if (exceptAppointmentId) where._id = { $ne: exceptAppointmentId }

    const docs = (await AppointmentModel()
      .find(where)
      .select({ startsAt: 1, endsAt: 1 })
      .limit(CALENDAR_LIMIT)
      .lean()) as unknown as Array<{ startsAt: Date; endsAt: Date }>
    return docs.map(({ startsAt, endsAt }) => ({ startsAt, endsAt }))
  },

  async applyChange(
    clinicId: string,
    appointmentId: string,
    patch: Record<string, unknown>,
    history: StoredStatusChange | null,
    tx?: Transaction,
  ): Promise<StoredAppointment | null> {
    const update: Record<string, unknown> = { $set: patch }
    if (history) update.$push = { statusHistory: history }

    const doc = await AppointmentModel()
      .findOneAndUpdate({ clinicId, _id: appointmentId }, update, {
        new: true,
        session: sessionOf(tx),
      })
      .lean()
    return doc ? toAppointment(doc as unknown as AppointmentRecord) : null
  },

  /**
   * Claims every grid cell the appointment covers. A second booking for any of them fails on
   * the unique `_id`, which `isSlotTaken` recognises (ADR-0013).
   */
  async reserve(
    input: { clinicId: string; doctorId: string; appointmentId: string; cellIds: string[] },
    tx?: Transaction,
  ): Promise<void> {
    await SlotReservationModel().insertMany(
      input.cellIds.map((id) => ({
        _id: id,
        clinicId: input.clinicId,
        doctorId: input.doctorId,
        appointmentId: input.appointmentId,
        cellStartsAt: new Date(id.slice(id.indexOf(':') + 1)),
        expiresAt: null,
      })),
      { session: sessionOf(tx), ordered: true },
    )
  },

  /** Cancelling, rescheduling or marking a no-show gives the time back. */
  async release(clinicId: string, appointmentId: string, tx?: Transaction): Promise<void> {
    await SlotReservationModel().deleteMany({ clinicId, appointmentId }, { session: sessionOf(tx) })
  },
}
