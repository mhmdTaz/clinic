import { AppointmentModel, SlotReservationModel, newId, nextFormatted } from '@clinic/db'
import type { AppointmentSource, AppointmentStatus } from '@clinic/config'
import type { PersonRef } from '@clinic/contracts'
import { sessionOf, type Transaction } from '../../../transaction'
import {
  decodeCursor,
  keysetAfter,
  pageFrom,
  sortFor,
  type Page,
  type SortKey,
} from '../../../pagination'
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
/** In the order they happen; `startsAt` is required on every appointment. */
const CALENDAR_ORDER: readonly SortKey[] = [
  { field: 'startsAt', direction: 1, kind: 'date' },
  { field: '_id', direction: 1, kind: 'string' },
]

function calendarFilter(
  clinicId: string,
  filter: {
    from: Date
    to: Date
    doctorId?: string
    patientId?: string
    status?: AppointmentStatus
    branchId?: string
  },
): Record<string, unknown> {
  const where: Record<string, unknown> = {
    clinicId,
    startsAt: { $gte: filter.from, $lt: filter.to },
  }
  if (filter.doctorId) where.doctorId = filter.doctorId
  if (filter.patientId) where.patientId = filter.patientId
  if (filter.status) where.status = filter.status
  if (filter.branchId) where.branchId = filter.branchId
  return where
}

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

  /** A page of the calendar. Before Phase 10: the first 2,000 in the range, and nothing said. */
  async list(
    clinicId: string,
    filter: Parameters<typeof calendarFilter>[1],
    page: { cursor?: string; limit: number },
  ): Promise<Page<StoredAppointment>> {
    const where = calendarFilter(clinicId, filter)
    if (page.cursor) {
      where.$and = [keysetAfter(CALENDAR_ORDER, decodeCursor(page.cursor, CALENDAR_ORDER.length))]
    }
    const docs = (await AppointmentModel()
      .find(where)
      .sort(sortFor(CALENDAR_ORDER))
      .limit(page.limit + 1)
      .lean()) as unknown as Array<AppointmentRecord & Record<string, unknown>>
    const { docs: rows, nextCursor } = pageFrom(docs, page.limit, CALENDAR_ORDER)
    return { items: rows.map(toAppointment), nextCursor }
  },

  /**
   * Every appointment in a window, for the reminder sweep. No cap: the first version read the sweep
   * through the calendar's 2,000-row limit, so a reminder beyond it was never sent and nothing said.
   */
  async listAll(
    clinicId: string,
    filter: Parameters<typeof calendarFilter>[1],
  ): Promise<StoredAppointment[]> {
    const docs = await AppointmentModel()
      .find(calendarFilter(clinicId, filter))
      .sort(sortFor(CALENDAR_ORDER))
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
      // No limit: one doctor's commitments over a bounded range. A cap here would offer as free a
      // time the doctor is already booked for.
      .select({ startsAt: 1, endsAt: 1 })
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
