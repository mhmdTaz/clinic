import type { AppointmentSummary } from '@clinic/contracts'

/**
 * Turning what the API returns into what a person reads.
 *
 * Pure, and in its own file for that reason: these are the rules most likely to be quietly wrong
 * — a timezone, an off-by-one on "upcoming", a status that should not count — and they are worth
 * testing without a device or a running app.
 */

/**
 * Every timestamp crosses the API as ISO-8601 UTC and is localised by the client (§9.2).
 *
 * **In the clinic's timezone, not the device's.** A patient travelling, or simply living in a
 * border town with their phone on the wrong side of it, must be told the time they should arrive
 * at the clinic. Using the device's zone would tell them a time that is correct everywhere except
 * at the door.
 */
export function formatWhen(iso: string, timeZone: string, locale = 'en-GB'): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'

  return new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  }).format(date)
}

/** Statuses that still hold a place in the day. A cancelled slot is not an appointment. */
const STILL_HAPPENING = new Set(['SCHEDULED', 'CHECKED_IN', 'IN_PROGRESS'])

/**
 * The next appointment that has not happened yet.
 *
 * `>= now` rather than `> now` is deliberate: an appointment starting this very second is still
 * the one to show, and treating it as past would blank the home screen at exactly the moment
 * somebody is standing at the desk checking it.
 *
 * The list is not assumed to be sorted. It arrives ordered today, and a home screen that silently
 * showed the wrong appointment because that changed is not a trade worth making for one sort.
 */
export function nextUpcoming(
  appointments: readonly AppointmentSummary[],
  now: Date = new Date(),
): AppointmentSummary | null {
  const upcoming = appointments
    .filter((appointment) => STILL_HAPPENING.has(appointment.status))
    .filter((appointment) => {
      const starts = Date.parse(appointment.startsAt)
      return Number.isFinite(starts) && starts >= now.getTime()
    })
    .sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt))

  return upcoming[0] ?? null
}

/**
 * Past appointments, newest first — the other half of the list.
 *
 * Cancelled ones are included here and excluded from "upcoming": a patient looking back wants to
 * see that they cancelled, and a patient looking forward does not.
 */
export function pastAppointments(
  appointments: readonly AppointmentSummary[],
  now: Date = new Date(),
): AppointmentSummary[] {
  return appointments
    .filter((appointment) => {
      const starts = Date.parse(appointment.startsAt)
      if (!Number.isFinite(starts)) return false
      return starts < now.getTime() || !STILL_HAPPENING.has(appointment.status)
    })
    .sort((left, right) => Date.parse(right.startsAt) - Date.parse(left.startsAt))
}

/** Upcoming appointments in the order they will happen. */
export function upcomingAppointments(
  appointments: readonly AppointmentSummary[],
  now: Date = new Date(),
): AppointmentSummary[] {
  return appointments
    .filter((appointment) => STILL_HAPPENING.has(appointment.status))
    .filter((appointment) => {
      const starts = Date.parse(appointment.startsAt)
      return Number.isFinite(starts) && starts >= now.getTime()
    })
    .sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt))
}

/**
 * Whether an appointment can still be called off from the app.
 *
 * The **server decides**; this only avoids offering a button that will be refused. Duplicating
 * the clinic's cancellation window here would be a second copy of a rule the clinic can change at
 * runtime, and the two would drift — so the check is deliberately coarse: has it happened yet.
 */
export const isCancellable = (appointment: AppointmentSummary, now: Date = new Date()): boolean =>
  STILL_HAPPENING.has(appointment.status) && Date.parse(appointment.startsAt) >= now.getTime()

/** "in 2 days", "tomorrow", "today" — the phrasing a reminder uses. */
export function relativeDay(iso: string, timeZone: string, now: Date = new Date()): string {
  const target = new Date(iso)
  if (Number.isNaN(target.getTime())) return ''

  const dayOf = (date: Date) =>
    new Intl.DateTimeFormat('en-CA', { timeZone, dateStyle: 'short' }).format(date)

  const targetDay = dayOf(target)
  if (targetDay === dayOf(now)) return 'today'

  const tomorrow = new Date(now.getTime() + 86_400_000)
  if (targetDay === dayOf(tomorrow)) return 'tomorrow'

  const days = Math.round((target.getTime() - now.getTime()) / 86_400_000)
  if (days < 0) return ''
  return `in ${days} days`
}
