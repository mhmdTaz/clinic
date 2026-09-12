import { env, REMINDER_OFFSETS_HOURS } from '@clinic/config'
import { appointmentsStartingBetween } from '@clinic/core/appointments'
import { getClinicFacts } from '@clinic/core/clinic'
import { deliver } from '@clinic/core/notifications'
import { findPatientForScheduling } from '@clinic/core/patients'
import { formatAppointmentTime } from '../lib/format'

/**
 * Appointment reminders (section 13.5) — **Phase 7's second exit criterion**: they fire correctly
 * across timezones, and a job that retries does not send them twice.
 *
 * Two decisions make that true, and neither is the obvious one.
 *
 * **The sweep reads the diary; it does not schedule a job per appointment.** Scheduling at
 * booking time would mean cancelling and rescheduling on every reschedule, and every path that
 * forgot would send a reminder for an appointment that had moved — silently, and only for the
 * patients affected. Reading the diary each tick is always current by construction: an
 * appointment that moved is simply found in its new window, and one that was cancelled is not
 * found at all.
 *
 * **Duplicates are stopped by the notification's dedupe key, not by remembering what was sent.**
 * The key is `reminder:<appointmentId>:<offset>` — derived from facts, never from the attempt —
 * so a job that times out after it had already delivered computes the same key on its retry and
 * loses on the unique index (ADR-0030). That also means the sweep can run as often as it likes
 * and overlap itself without consequence, which is what makes a five-minute tick safe.
 *
 * **Across timezones**: the offsets are elapsed hours from the appointment's instant, so "24
 * hours before" means 24 hours even across a daylight-saving change — which is what somebody
 * being reminded understands by it. Only the *rendering* is zoned, in the clinic's own timezone,
 * so the time in the message is the time on the clinic's wall.
 */
export interface ReminderSweepResult {
  considered: number
  sent: number
  alreadySent: number
}

/** How wide a net each tick casts. Comfortably wider than the tick, so nothing falls between. */
const WINDOW_MINUTES = 10

export async function sweepReminders(now: Date = new Date()): Promise<ReminderSweepResult> {
  const clinicId = env().CLINIC_ID
  const clinic = await getClinicFacts(clinicId)
  const result: ReminderSweepResult = { considered: 0, sent: 0, alreadySent: 0 }

  for (const offsetHours of REMINDER_OFFSETS_HOURS) {
    // Appointments whose reminder is due about now: those starting `offset` hours from here,
    // give or take the window. Overlapping windows are harmless — the dedupe key settles it.
    const centre = now.getTime() + offsetHours * 3_600_000
    const from = new Date(centre - WINDOW_MINUTES * 60_000)
    const to = new Date(centre + WINDOW_MINUTES * 60_000)

    const appointments = await appointmentsStartingBetween(clinicId, from, to)
    result.considered += appointments.length

    for (const appointment of appointments) {
      const patient = await findPatientForScheduling(clinicId, appointment.patientId)
      // No portal account, nowhere for it to land. The clinic still has the diary.
      if (!patient?.userId) continue

      const when = formatAppointmentTime(appointment.startsAt, clinic.timezone)
      const outcome = await deliver({
        clinicId,
        userIds: [patient.userId],
        type: 'APPOINTMENT_REMINDER',
        title: offsetHours >= 24 ? 'Your appointment is tomorrow' : 'Your appointment is soon',
        body: `${when} with ${appointment.doctorName}.`,
        emailBody: `A reminder that your appointment with ${appointment.doctorName} is ${when}.\n\nIf you can no longer make it, please let the clinic know so somebody else can take the slot.`,
        href: '/patient/appointments',
        entity: { type: 'Appointment', id: appointment.id },
        action: { href: '/patient/appointments', label: 'View your appointments' },
        // The whole guarantee, in one line: facts only, no timestamp, no attempt number.
        dedupeKey: `reminder:${appointment.id}:${offsetHours}`,
      })

      result.sent += outcome.created
      result.alreadySent += outcome.duplicates
    }
  }

  return result
}
