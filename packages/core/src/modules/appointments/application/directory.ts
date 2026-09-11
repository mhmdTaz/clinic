import type { AppointmentDetail, AppointmentListQuery, AppointmentSummary } from '@clinic/contracts'
import { NotFoundError } from '../../../errors'
import { assertCan, type Actor } from '../../access'
import { getClinicFacts } from '../../clinic'
import { instantOf, nextDate } from '../../scheduling'
import {
  appointmentRepository,
  type StoredAppointment,
} from '../infrastructure/appointment.repository'
import { appointmentListScope, appointmentResource, readsWholeClinic } from './scope'

const iso = (date: Date | null) => (date ? date.toISOString() : null)

export function toAppointmentSummary(appointment: StoredAppointment): AppointmentSummary {
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
  }
}

/** `internalNote` is staff-only, so a patient reading their own appointment never receives it. */
export function toAppointmentDetail(
  appointment: StoredAppointment,
  options: { includeInternalNote: boolean },
): AppointmentDetail {
  return {
    ...toAppointmentSummary(appointment),
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
  query: AppointmentListQuery,
): Promise<AppointmentSummary[]> {
  const scope = await appointmentListScope(actor)
  const clinic = await getClinicFacts(actor.clinicId)

  const from = instantOf(query.from, '00:00', clinic.timezone)
  const to = instantOf(nextDate(query.to), '00:00', clinic.timezone)

  const appointments = await appointmentRepository.list(actor.clinicId, {
    from,
    to,
    doctorId: scope.doctorId ?? query.doctorId,
    patientId: scope.patientId ?? query.patientId,
    status: query.status,
    branchId: query.branchId,
  })
  return appointments.map(toAppointmentSummary)
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
  return toAppointmentDetail(appointment, { includeInternalNote })
}
