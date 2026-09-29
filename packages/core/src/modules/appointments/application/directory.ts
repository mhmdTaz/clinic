import type { AppointmentDetail, AppointmentListQuery, AppointmentSummary } from '@clinic/contracts'
import { NotFoundError } from '../../../errors'
import { pageLimit, type Page } from '../../../pagination'
import { assertCan, type Actor } from '../../access'
import { findBookingWindow, getClinicFacts } from '../../clinic'
import {
  bookingWindowOf,
  changeableOnlineUntil,
  instantOf,
  nextDate,
  type BookingWindow,
} from '../../scheduling'
import { holdsSlot } from '../domain/status'
import {
  appointmentRepository,
  type StoredAppointment,
} from '../infrastructure/appointment.repository'
import { appointmentListScope, appointmentResource, readsWholeClinic } from './scope'

const iso = (date: Date | null) => (date ? date.toISOString() : null)

/**
 * The clinic's self-service window, which every summary carries the consequence of. A fact about
 * the clinic rather than a read of its settings, so no clinic:read is asked of a patient for it.
 */
export async function selfServiceWindow(clinicId: string): Promise<BookingWindow> {
  return bookingWindowOf(await findBookingWindow(clinicId))
}

export function toAppointmentSummary(
  appointment: StoredAppointment,
  window: BookingWindow,
): AppointmentSummary {
  return {
    id: appointment.id,
    number: appointment.number,
    status: appointment.status,
    source: appointment.source,
    startsAt: appointment.startsAt.toISOString(),
    endsAt: appointment.endsAt.toISOString(),
    durationMinutes: appointment.durationMinutes,
    patient: {
      id: appointment.patientId,
      name: appointment.patient.name,
      medicalRecordNo: appointment.patient.medicalRecordNo,
      phone: appointment.patient.phone,
    },
    doctor: { id: appointment.doctorId, name: appointment.doctor.name },
    branchId: appointment.branchId,
    reason: appointment.reason,
    changeableOnlineUntil: holdsSlot(appointment.status)
      ? changeableOnlineUntil(appointment.startsAt, window).toISOString()
      : null,
  }
}

/** `internalNote` is staff-only, so a patient reading their own appointment never receives it. */
export function toAppointmentDetail(
  appointment: StoredAppointment,
  options: { includeInternalNote: boolean; window: BookingWindow },
): AppointmentDetail {
  return {
    ...toAppointmentSummary(appointment, options.window),
    internalNote: options.includeInternalNote ? appointment.internalNote : null,
    checkedInAt: iso(appointment.checkedInAt),
    startedAt: iso(appointment.startedAt),
    completedAt: iso(appointment.completedAt),
    cancelledAt: iso(appointment.cancelledAt),
    cancelReason: appointment.cancelReason,
    rescheduledToId: appointment.rescheduledToId,
    statusHistory: appointment.statusHistory.map((entry) => ({
      fromStatus: entry.fromStatus,
      toStatus: entry.toStatus,
      reason: entry.reason,
      changedBy: entry.changedBy,
      changedAt: entry.changedAt.toISOString(),
    })),
    createdAt: iso(appointment.createdAt),
    createdBy: appointment.createdBy,
  }
}

/**
 * The calendar (S5, D5, P3). The date range is read in the clinic's timezone, so "this week"
 * means the clinic's week wherever the person asking happens to be.
 */
export async function listAppointments(
  actor: Actor,
  query: Omit<AppointmentListQuery, 'limit'> & { limit?: number },
): Promise<Page<AppointmentSummary>> {
  const scope = await appointmentListScope(actor)
  const [clinic, window] = await Promise.all([
    getClinicFacts(actor.clinicId),
    selfServiceWindow(actor.clinicId),
  ])

  const from = instantOf(query.from, '00:00', clinic.timezone)
  const to = instantOf(nextDate(query.to), '00:00', clinic.timezone)

  const page = await appointmentRepository.list(
    actor.clinicId,
    {
      from,
      to,
      doctorId: scope.doctorId ?? query.doctorId,
      patientId: scope.patientId ?? query.patientId,
      status: query.status,
      branchId: query.branchId,
    },
    { cursor: query.cursor, limit: pageLimit(query.limit) },
  )
  return {
    items: page.items.map((appointment) => toAppointmentSummary(appointment, window)),
    nextCursor: page.nextCursor,
  }
}

export async function getAppointment(
  actor: Actor,
  appointmentId: string,
): Promise<AppointmentDetail> {
  const appointment = await appointmentRepository.findById(actor.clinicId, appointmentId)
  if (!appointment) throw new NotFoundError('Appointment')

  await assertCan(
    actor,
    'appointment:read',
    appointmentResource(actor, {
      id: appointment.id,
      doctorId: appointment.doctorId,
      patientId: appointment.patientId,
    }),
  )

  const includeInternalNote = readsWholeClinic(actor) || actor.doctorId === appointment.doctorId
  return toAppointmentDetail(appointment, {
    includeInternalNote,
    window: await selfServiceWindow(actor.clinicId),
  })
}
