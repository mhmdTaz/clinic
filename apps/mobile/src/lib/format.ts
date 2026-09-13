import {
  localDateIn,
  type AppointmentStatus,
  type AppointmentSummary,
  type EncounterType,
  type FileCategory,
  type TicketCategory,
  type TicketStatus,
} from '@clinic/contracts'

/**
 * Turning what the API returns into what a person reads.
 *
 * Pure, and in its own file for that reason: these are the rules most likely to be quietly wrong
 * — a timezone, an off-by-one on "upcoming", a status that should not count — and they are worth
 * testing without a device or a running app.
 *
 * **Every time is shown in the clinic's timezone, never the device's.** A patient travelling, or
 * living in a border town with their phone on the wrong side of it, must be told the time they
 * should arrive at the clinic. The device's zone gives a time that is correct everywhere except at
 * the door.
 */

const LOCALE = 'en-GB'

const valid = (iso: string): Date | null => {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? null : date
}

/** "Mon 21 Sept, 09:30" — an appointment, a message, a signature. */
export function formatWhen(iso: string, timeZone: string): string {
  const date = valid(iso)
  if (!date) return '—'
  return new Intl.DateTimeFormat(LOCALE, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  }).format(date)
}

/** "09:30" — a slot in a list already grouped by day. */
export function formatTime(iso: string, timeZone: string): string {
  const date = valid(iso)
  if (!date) return '—'
  return new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit', timeZone }).format(
    date,
  )
}

/**
 * "Monday 21 September" from a calendar date.
 *
 * A calendar date has no zone — it is a day, not an instant — so it is read as noon UTC and
 * formatted in UTC. Formatting midnight in a local zone is how "21 September" becomes "20".
 */
export function formatCalendarDate(
  date: string,
  style: 'long' | 'short' | 'plain' = 'long',
): string {
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T12:00:00Z`) : null
  if (!parsed || Number.isNaN(parsed.getTime())) return '—'
  return new Intl.DateTimeFormat(LOCALE, {
    // A weekday belongs to a day in a diary, not to a date of birth.
    ...(style === 'plain' ? {} : { weekday: style === 'long' ? 'long' : 'short' }),
    day: 'numeric',
    month: style === 'short' ? 'short' : 'long',
    ...(style === 'short' ? {} : { year: 'numeric' }),
    timeZone: 'UTC',
  }).format(parsed)
}

/** A calendar date moved by whole days, without passing through anybody's timezone. */
export function shiftDate(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number)
  const moved = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, (day ?? 1) + days))
  return moved.toISOString().slice(0, 10)
}

const dayNumber = (date: string): number => Date.parse(`${date}T00:00:00Z`) / 86_400_000

/**
 * "today", "tomorrow", "in 3 days" — the phrasing a reminder uses.
 *
 * **Counted in calendar days at the clinic, not in 24-hour periods.** The first version divided
 * the gap in milliseconds by a day and rounded, so at ten at night an appointment at eight the
 * morning after tomorrow was 34 hours away, rounded to one: "in 1 days", for something two days
 * off, with a grammatical error thrown in.
 */
export function relativeDay(iso: string, timeZone: string, now: Date = new Date()): string {
  const target = valid(iso)
  if (!target) return ''
  const days = dayNumber(localDateIn(timeZone, target)) - dayNumber(localDateIn(timeZone, now))
  if (days < 0) return ''
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  return `in ${days} days`
}

/**
 * "just now", "12 minutes ago", "3 hours ago" — how old a read is that could not be refreshed.
 *
 * Relative rather than a clock time on purpose: "loaded 3 hours ago" tells somebody how far to
 * trust it without making them do arithmetic against a clock in another zone.
 */
export function ageLabel(fetchedAt: number, now: number = Date.now()): string {
  const minutes = Math.floor((now - fetchedAt) / 60_000)
  if (!Number.isFinite(minutes) || minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

/** Whole years between a date of birth and a calendar date, both at the clinic. */
export function ageOn(dateOfBirth: string, today: string): number | null {
  const birth = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateOfBirth)
  const now = /^(\d{4})-(\d{2})-(\d{2})/.exec(today)
  if (!birth || !now) return null
  let years = Number(now[1]) - Number(birth[1])
  // Not yet had this year's birthday. Compared as month-day strings, so 29 February behaves.
  if (`${now[2]}-${now[3]}` < `${birth[2]}-${birth[3]}`) years -= 1
  return years >= 0 ? years : null
}

/** "2.4 MB" — a document's size, in the units a person recognises. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// ── Appointments ─────────────────────────────────────────────────────────────

/** Statuses that still hold a place in the day. A cancelled slot is not an appointment. */
const STILL_HAPPENING = new Set<AppointmentStatus>(['SCHEDULED', 'CHECKED_IN', 'IN_PROGRESS'])

const startsAtOf = (appointment: AppointmentSummary): number => Date.parse(appointment.startsAt)

/**
 * Upcoming appointments in the order they will happen.
 *
 * `>= now` rather than `> now` is deliberate: an appointment starting this very second is still
 * the one to show, and treating it as past would blank the home screen at exactly the moment
 * somebody is standing at the desk checking it.
 *
 * The list is not assumed to be sorted. It arrives ordered today, and a home screen that silently
 * showed the wrong appointment because that changed is not a trade worth making for one sort.
 */
export function upcomingAppointments(
  appointments: readonly AppointmentSummary[],
  now: Date = new Date(),
): AppointmentSummary[] {
  return appointments
    .filter((appointment) => STILL_HAPPENING.has(appointment.status))
    .filter((appointment) => {
      const starts = startsAtOf(appointment)
      return Number.isFinite(starts) && starts >= now.getTime()
    })
    .sort((left, right) => startsAtOf(left) - startsAtOf(right))
}

/** The next appointment that has not happened yet. */
export const nextUpcoming = (
  appointments: readonly AppointmentSummary[],
  now: Date = new Date(),
): AppointmentSummary | null => upcomingAppointments(appointments, now)[0] ?? null

/**
 * Everything that is not upcoming, newest first: the past, and cancellations.
 *
 * A cancelled appointment next week is here and not above. A patient looking forward does not
 * want to see it; a patient looking back wants to see that they cancelled. The heading on screen
 * says "Past and cancelled" so the one in the future is not a surprise.
 */
export function pastAppointments(
  appointments: readonly AppointmentSummary[],
  now: Date = new Date(),
): AppointmentSummary[] {
  return appointments
    .filter((appointment) => {
      const starts = startsAtOf(appointment)
      if (!Number.isFinite(starts)) return false
      return starts < now.getTime() || !STILL_HAPPENING.has(appointment.status)
    })
    .sort((left, right) => startsAtOf(right) - startsAtOf(left))
}

/**
 * Whether to offer cancelling from the app.
 *
 * The **server decides**; this only avoids offering a button that will be refused. Duplicating
 * the clinic's cancellation window here would be a second copy of a rule the clinic can change at
 * runtime, and the two would drift — so the check is deliberately coarse: has it started yet.
 */
export const isCancellable = (appointment: AppointmentSummary, now: Date = new Date()): boolean =>
  STILL_HAPPENING.has(appointment.status) && startsAtOf(appointment) >= now.getTime()

/** A week at a time: far enough to find something, short enough to read on a phone. */
export const BOOKING_WEEK_DAYS = 7

/**
 * The week of open times a booking screen shows, and how many weeks ahead it may go.
 *
 * The last bookable date is `today + horizonDays` — the web's own reckoning — because the server
 * accepts a start up to `horizonDays × 24h` from now, which lands on that calendar date. The final
 * week is cut at that date rather than run to its seventh day, so the screen never asks for, or
 * shows, a day the server would only refuse. An unknown horizon offers this week and no further:
 * guessing a later one is how the first version came to offer eight weeks at every clinic.
 */
export function bookingWeek(
  today: string,
  horizonDays: number | null,
  offset: number,
): { from: string; to: string; lastOffset: number } {
  const lastOffset =
    horizonDays === null ? 0 : Math.floor(Math.max(0, horizonDays) / BOOKING_WEEK_DAYS)
  const week = Math.min(Math.max(0, offset), lastOffset)
  const from = shiftDate(today, week * BOOKING_WEEK_DAYS)
  const weekEnd = shiftDate(from, BOOKING_WEEK_DAYS - 1)
  const lastBookable = horizonDays === null ? weekEnd : shiftDate(today, Math.max(0, horizonDays))
  return { from, to: weekEnd < lastBookable ? weekEnd : lastBookable, lastOffset }
}

/*
 * The labels below are the web's English catalogue, word for word (apps/web/messages/en.json). A
 * patient who reads "Waiting on you" in an email and "Waiting for you" in the app has been given
 * two statuses, not one.
 */

const APPOINTMENT_STATUS_LABELS: Record<AppointmentStatus, string> = {
  SCHEDULED: 'Scheduled',
  CHECKED_IN: 'Checked in',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  NO_SHOW: 'Did not attend',
}

export const appointmentStatusLabel = (status: AppointmentStatus): string =>
  APPOINTMENT_STATUS_LABELS[status] ?? status

// ── Labels the API sends as codes ────────────────────────────────────────────

const ENCOUNTER_TYPE_LABELS: Record<EncounterType, string> = {
  CONSULTATION: 'Consultation',
  FOLLOW_UP: 'Follow-up',
  PROCEDURE: 'Procedure',
  EMERGENCY: 'Emergency',
  TELEHEALTH: 'Telehealth',
}
export const encounterTypeLabel = (type: EncounterType): string =>
  ENCOUNTER_TYPE_LABELS[type] ?? type

const FILE_CATEGORY_LABELS: Record<FileCategory, string> = {
  LAB_RESULT: 'Lab result',
  IMAGING: 'Imaging',
  REFERRAL: 'Referral',
  CONSENT: 'Consent form',
  PRESCRIPTION: 'Prescription',
  INSURANCE: 'Insurance',
  OTHER: 'Other',
}
export const fileCategoryLabel = (category: FileCategory): string =>
  FILE_CATEGORY_LABELS[category] ?? category

const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  OPEN: 'Open',
  IN_PROGRESS: 'Being looked at',
  PENDING: 'Waiting on you',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
}
export const ticketStatusLabel = (status: TicketStatus): string =>
  TICKET_STATUS_LABELS[status] ?? status

export const TICKET_CATEGORY_LABELS: Record<TicketCategory, string> = {
  APPOINTMENT: 'Appointments',
  BILLING: 'Billing',
  MEDICAL_RECORDS: 'Medical records',
  TECHNICAL: 'Something is broken',
  OTHER: 'Something else',
}
