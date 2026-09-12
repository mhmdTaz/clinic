import { appointmentRepository } from '../infrastructure/appointment.repository'

/**
 * What a background job needs to know about an appointment, with no actor to check.
 *
 * Deliberately narrow, and deliberately not `getAppointment`: that one takes an actor and
 * enforces scope, which is right for a request and meaningless for a reminder nobody asked for.
 * Returning a small named shape rather than the whole record keeps the worker from growing a
 * dependency on fields it has no business reading.
 */
export interface AppointmentNotificationFacts {
  id: string
  patientId: string
  patientUserId: string | null
  doctorId: string
  patientName: string
  doctorName: string
  startsAt: Date
  endsAt: Date
  status: string
  reason: string | null
}

export async function findAppointmentForNotification(
  clinicId: string,
  appointmentId: string,
): Promise<AppointmentNotificationFacts | null> {
  const appointment = await appointmentRepository.findById(clinicId, appointmentId)
  if (!appointment) return null

  return {
    id: appointment.id,
    patientId: appointment.patientId,
    patientUserId: null,
    doctorId: appointment.doctorId,
    patientName: appointment.patient.name,
    doctorName: appointment.doctor.name,
    startsAt: appointment.startsAt,
    endsAt: appointment.endsAt,
    status: appointment.status,
    reason: appointment.reason,
  }
}

/**
 * Appointments starting inside a window, for the reminder sweep.
 *
 * Only the statuses that still hold a slot: a cancelled appointment is not something to remind
 * anybody about, and a completed one has already happened.
 */
export async function appointmentsStartingBetween(
  clinicId: string,
  from: Date,
  to: Date,
): Promise<AppointmentNotificationFacts[]> {
  const appointments = await appointmentRepository.list(clinicId, { from, to })
  return appointments
    .filter(
      (appointment) => appointment.status === 'SCHEDULED' || appointment.status === 'CHECKED_IN',
    )
    .map((appointment) => ({
      id: appointment.id,
      patientId: appointment.patientId,
      patientUserId: null,
      doctorId: appointment.doctorId,
      patientName: appointment.patient.name,
      doctorName: appointment.doctor.name,
      startsAt: appointment.startsAt,
      endsAt: appointment.endsAt,
      status: appointment.status,
      reason: appointment.reason,
    }))
}
