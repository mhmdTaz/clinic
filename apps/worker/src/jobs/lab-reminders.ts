import { env, resolveFeatureFlags, type FeatureFlags } from '@clinic/config'
import { usersHolding } from '@clinic/core/access'
import { appointmentsStartingBetween } from '@clinic/core/appointments'
import { getClinicSessionInfo } from '@clinic/core/clinic'
import { labWorkAtLabFor } from '@clinic/core/dental'
import { deliver } from '@clinic/core/notifications'
import { formatAppointmentTime } from '../lib/format'

/**
 * Lab work that is not back for tomorrow's patient (Phase 13).
 *
 * A crown fitted tomorrow that is still at the lab today is a wasted appointment unless somebody
 * phones the lab this afternoon — or the patient, to move them. So a day before each appointment,
 * the front desk hears about any work for that patient still at the lab.
 *
 * It is built the way the appointment reminders are, for the same reasons: it reads the diary each
 * tick rather than scheduling a job per appointment, so a moved appointment is simply found in its
 * new window; and duplicates are stopped by a key made of facts — the appointment and the order —
 * so a retried or overlapping sweep loses on the unique index rather than sending twice.
 *
 * The notice names the patient, so it goes only to those who read every patient's chart: the
 * permission at clinic scope, not a doctor who holds it for their own patients.
 */
export interface LabReminderSweepResult {
  considered: number
  sent: number
  alreadySent: number
}

const HOURS_BEFORE = 24
/** How wide a net each tick casts. Comfortably wider than the tick, so nothing falls between. */
const WINDOW_MINUTES = 10

export async function sweepLabReminders(now: Date = new Date()): Promise<LabReminderSweepResult> {
  const clinicId = env().CLINIC_ID
  const result: LabReminderSweepResult = { considered: 0, sent: 0, alreadySent: 0 }

  const clinic = await getClinicSessionInfo(clinicId)
  const flags = resolveFeatureFlags(clinic.featureFlags as Partial<FeatureFlags>)
  if (!flags.dental || !flags.labOrders) return result

  const centre = now.getTime() + HOURS_BEFORE * 3_600_000
  const appointments = await appointmentsStartingBetween(
    clinicId,
    new Date(centre - WINDOW_MINUTES * 60_000),
    new Date(centre + WINDOW_MINUTES * 60_000),
  )
  if (appointments.length === 0) return result

  const waiting = await labWorkAtLabFor(clinicId, [
    ...new Set(appointments.map((appointment) => appointment.patientId)),
  ])
  if (waiting.length === 0) return result

  const audience = await usersHolding(clinicId, 'dental:write', 'CLINIC')
  if (audience.length === 0) return result

  for (const appointment of appointments) {
    for (const order of waiting.filter((entry) => entry.patientId === appointment.patientId)) {
      result.considered += 1
      const when = formatAppointmentTime(appointment.startsAt, clinic.timezone)
      const work = order.work.join(', ')
      const teeth = order.teeth.length > 0 ? ` (${order.teeth.join(', ')})` : ''
      const outcome = await deliver({
        clinicId,
        userIds: audience,
        type: 'LAB_WORK_LATE',
        title: `Lab work not back for ${order.patientName}`,
        body: `${order.patientName} is booked ${when}. The ${work}${teeth} from ${order.labName}, due ${order.dueOn}, has not come in.`,
        emailBody:
          `${order.patientName} is booked ${when} with ${appointment.doctorName}.\n\n` +
          `The ${work}${teeth} sent to ${order.labName}, due ${order.dueOn}, has not been marked as received. ` +
          'Call the lab today, or move the appointment.',
        href: `/staff/patients/${order.patientId}`,
        entity: { type: 'LabOrder', id: order.id },
        action: { href: '/staff/dental/lab', label: 'Open the lab board' },
        // Facts only: this appointment, this order. A retry computes the same key.
        dedupeKey: `lab.late:${appointment.id}:${order.id}`,
      })
      result.sent += outcome.created
      result.alreadySent += outcome.duplicates
    }
  }
  return result
}
