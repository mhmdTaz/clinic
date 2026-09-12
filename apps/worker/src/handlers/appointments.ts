import { assertEventPayload, type OutboxEnvelope } from '@clinic/events'
import { findAppointmentForNotification } from '@clinic/core/appointments'
import { deliver } from '@clinic/core/notifications'
import { findPatientForScheduling } from '@clinic/core/patients'
import { getClinicFacts } from '@clinic/core/clinic'
import { formatAppointmentTime } from '../lib/format'

/**
 * A booking was made. The patient gets a confirmation, in their clinic's own timezone.
 *
 * The reminders that follow are **not** scheduled here. A reminder is due at a fixed offset
 * before the appointment, and an appointment can be moved — so scheduling a job now would mean
 * cancelling and rescheduling it on every change, and getting that wrong silently. The sweep in
 * `jobs/reminders.ts` reads the diary instead, which is always current by construction
 * (ADR-0030).
 */
export async function onAppointmentBooked(envelope: OutboxEnvelope): Promise<void> {
  const { appointmentId } = assertEventPayload('appointment.booked', envelope.payload)
  const context = await appointmentContext(envelope.clinicId, appointmentId)
  if (!context) return

  const { appointment, userId, timezone } = context
  const when = formatAppointmentTime(appointment.startsAt, timezone)

  await deliver({
    clinicId: envelope.clinicId,
    userIds: [userId],
    type: 'APPOINTMENT_CONFIRMED',
    title: 'Your appointment is booked',
    body: `${when} with ${appointment.doctorName}.`,
    emailBody: `Your appointment with ${appointment.doctorName} is booked for ${when}.\n\nIf you need to change or cancel it, you can do that from your appointments page.`,
    href: '/patient/appointments',
    entity: { type: 'Appointment', id: appointment.id },
    action: { href: '/patient/appointments', label: 'View your appointments' },
    dedupeKey: `appointment.booked:${appointment.id}`,
  })
}

/** A booking was cancelled. This one cannot be switched off — see the preferences domain. */
export async function onAppointmentCancelled(envelope: OutboxEnvelope): Promise<void> {
  const { appointmentId, reason } = assertEventPayload('appointment.cancelled', envelope.payload)
  const context = await appointmentContext(envelope.clinicId, appointmentId)
  if (!context) return

  const { appointment, userId, timezone } = context
  const when = formatAppointmentTime(appointment.startsAt, timezone)

  await deliver({
    clinicId: envelope.clinicId,
    userIds: [userId],
    type: 'APPOINTMENT_CANCELLED',
    title: 'Your appointment was cancelled',
    body: `${when} with ${appointment.doctorName}${reason ? ` — ${reason}` : ''}.`,
    emailBody: `Your appointment with ${appointment.doctorName} on ${when} has been cancelled.${
      reason ? `\n\nReason: ${reason}` : ''
    }\n\nYou can book another time whenever suits you.`,
    href: '/patient/appointments',
    entity: { type: 'Appointment', id: appointment.id },
    action: { href: '/patient/appointments/new', label: 'Book another time' },
    // Cancelling twice is not a thing, but a retried job is: keyed by the appointment.
    dedupeKey: `appointment.cancelled:${appointment.id}`,
  })
}

/**
 * The appointment, the patient's account, and the clinic's timezone — everything a message about
 * an appointment needs.
 *
 * Null when the patient has no portal account: there is nowhere for a notification to land, and
 * inventing somewhere would be worse than staying quiet. The clinic still has the diary.
 */
export async function appointmentContext(clinicId: string, appointmentId: string) {
  const appointment = await findAppointmentForNotification(clinicId, appointmentId)
  if (!appointment) return null

  const [patient, clinic] = await Promise.all([
    findPatientForScheduling(clinicId, appointment.patientId),
    getClinicFacts(clinicId),
  ])
  if (!patient?.userId) return null

  return { appointment, userId: patient.userId, timezone: clinic.timezone }
}
