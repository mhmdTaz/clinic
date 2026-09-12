/**
 * How busy a doctor actually was (A8).
 *
 * Utilisation is booked minutes over **rostered** minutes, and the denominator is the part that
 * is easy to get wrong. Dividing by the length of the range would say a doctor who works two days
 * a week is 40% utilised while fully booked; dividing by "minutes with an appointment in them"
 * would say everybody is at 100%. The honest denominator is the time the doctor was scheduled to
 * be available, minus their time off, minus the days the clinic was shut.
 *
 * Pure. It takes the roster and gives back a number, which is what makes it testable without a
 * database and what keeps the timezone handling in one place upstream.
 */

export interface RosterBlock {
  /** 0 = Sunday, matching `weekdayOf`. */
  dayOfWeek: number
  /** "HH:mm", local to the clinic. */
  startsAt: string
  endsAt: string
}

export interface TimeOff {
  /** Inclusive on both ends, as a clinic would say it: "off the 3rd to the 7th". */
  startDate: string
  endDate: string
}

const minutesOf = (time: string): number => {
  const [hour = 0, minute = 0] = time.split(':').map(Number)
  return hour * 60 + minute
}

/** A block that ends before it starts contributes nothing rather than negative time. */
const blockMinutes = (block: RosterBlock): number =>
  Math.max(0, minutesOf(block.endsAt) - minutesOf(block.startsAt))

export function isOff(date: string, timeOff: readonly TimeOff[]): boolean {
  // Dates are ISO "YYYY-MM-DD", so a string comparison is a date comparison — and inclusive on
  // both ends, because a doctor off "the 3rd to the 7th" is not back on the 7th.
  return timeOff.some((period) => date >= period.startDate && date <= period.endDate)
}

/**
 * Rostered minutes across the given dates.
 *
 * `closedDates` comes from the clinic's holidays: a doctor rostered on a day the clinic is shut
 * was not available, and counting that time would depress every utilisation figure in December.
 */
export function rosteredMinutes(
  dates: readonly string[],
  weekdayOf: (date: string) => number,
  availability: readonly RosterBlock[],
  timeOff: readonly TimeOff[] = [],
  closedDates: readonly string[] = [],
): number {
  const closed = new Set(closedDates)
  let total = 0

  for (const date of dates) {
    if (closed.has(date) || isOff(date, timeOff)) continue
    const weekday = weekdayOf(date)
    for (const block of availability) {
      if (block.dayOfWeek === weekday) total += blockMinutes(block)
    }
  }

  return total
}

/**
 * Booked over rostered, as a percentage to one decimal place.
 *
 * **Null when nothing was rostered**, deliberately. A doctor with no availability in the range
 * is not 0% utilised — they were not scheduled to work, which is a different fact and should read
 * as "—" on the dashboard rather than as an alarming zero. Returning 0 here would quietly turn
 * "we never rostered them" into "they did nothing".
 *
 * Can exceed 100: an overbooked or double-booked doctor is real, and clamping it would hide the
 * one case the number is most useful for.
 */
export function utilisationPercent(bookedMinutes: number, availableMinutes: number): number | null {
  if (availableMinutes <= 0) return null
  return Math.round((bookedMinutes / availableMinutes) * 1000) / 10
}

/** A rate over a total, to one decimal place. Zero total reads as 0, not NaN. */
export function rate(part: number, total: number): number {
  if (total <= 0) return 0
  return Math.round((part / total) * 1000) / 10
}
