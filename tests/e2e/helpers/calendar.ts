/**
 * Calendar dates for the journeys, read in the seeded clinic's timezone. "Tomorrow" in Beirut
 * is not tomorrow in UTC after 21:00, and a suite that booked the wrong day at night would be
 * the kind of flake nobody enjoys chasing.
 */
export const CLINIC_ZONE = 'Asia/Beirut'

export function clinicToday(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CLINIC_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

function partsOf(date: string): [number, number, number] {
  const [year, month, day] = date.split('-').map(Number)
  return [year ?? 1970, month ?? 1, day ?? 1]
}

export function shiftDate(date: string, days: number): string {
  const [year, month, day] = partsOf(date)
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}

function isWeekend(date: string): boolean {
  const weekday = weekdayOfDate(date)
  return weekday === 0 || weekday === 6
}

/**
 * A day the seeded doctor actually works, at least `daysAhead` from today. Each journey asks
 * for a different one, so two tests never compete for the same slots.
 */
export function workingDate(daysAhead: number): string {
  let date = shiftDate(clinicToday(), daysAhead)
  while (isWeekend(date)) date = shiftDate(date, 1)
  return date
}

/** Minutes past midnight in the clinic's zone — walk-ins only make sense while the day is open. */
export function clinicMinutesOfDay(now: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: CLINIC_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now)
  const part = (type: string) => Number(parts.find((entry) => entry.type === type)?.value ?? '0')
  return part('hour') * 60 + part('minute')
}

/** The date's own weekday, 0 = Sunday, read in UTC like the date string itself. */
export function weekdayOfDate(date: string): number {
  const [year, month, day] = partsOf(date)
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay()
}
