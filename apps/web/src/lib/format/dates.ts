/**
 * Calendar dates — a birthday, a holiday — are "YYYY-MM-DD" strings. They are formatted as the
 * date they are, pinned to UTC, so no timezone can move them a day. Instants are formatted in the
 * clinic's timezone by the caller (ADR-0010).
 */
function partsOf(value: string): [number, number, number] {
  const [year, month, day] = value.split('-').map(Number)
  return [year ?? 1970, month ?? 1, day ?? 1]
}

export function formatCalendarDate(
  value: string,
  locale: string,
  style: 'medium' | 'long' | 'full' = 'medium',
): string {
  const [year, month, day] = partsOf(value)
  return new Intl.DateTimeFormat(locale, { dateStyle: style, timeZone: 'UTC' }).format(
    new Date(Date.UTC(year, month - 1, day)),
  )
}

/** Whole years between a birth date and today; the birthday counts only once it has arrived. */
export function ageOn(dateOfBirth: string, today: string): number {
  const [birthYear, birthMonth, birthDay] = partsOf(dateOfBirth)
  const [year, month, day] = partsOf(today)
  const birthdayPassed = month > birthMonth || (month === birthMonth && day >= birthDay)
  return year - birthYear - (birthdayPassed ? 0 : 1)
}

export function formatInstant(iso: string, locale: string, timeZone: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  }).format(new Date(iso))
}

/** The clock face of an instant, in the clinic's zone — "09:20", or "9:20 AM" where that is the norm. */
export function formatTimeOfDay(iso: string, locale: string, timeZone: string): string {
  return new Intl.DateTimeFormat(locale, { timeStyle: 'short', timeZone }).format(new Date(iso))
}

export function formatTimeRange(
  startsAt: string,
  endsAt: string,
  locale: string,
  timeZone: string,
): string {
  return `${formatTimeOfDay(startsAt, locale, timeZone)} – ${formatTimeOfDay(endsAt, locale, timeZone)}`
}

/** A column heading: the weekday and the day of the month, without the year. */
export function formatDayHeading(value: string, locale: string): string {
  const [year, month, day] = partsOf(value)
  return new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, day)))
}

/**
 * Calendar-date arithmetic, done in UTC on the "YYYY-MM-DD" string itself. Stepping a day never
 * lands on 23:00 the day before, whatever the browser's zone or a DST change (ADR-0010).
 */
export function shiftDate(value: string, days: number): string {
  const [year, month, day] = partsOf(value)
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}

/** The date's own weekday, 0 = Sunday, read in UTC like the date itself. */
export function weekdayOfDate(value: string): number {
  const [year, month, day] = partsOf(value)
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay()
}

/** Monday, the first column of the week the date falls in (WEEK_ORDER). */
export function startOfWeek(value: string): string {
  return shiftDate(value, -((weekdayOfDate(value) + 6) % 7))
}

/** Every date from `from` to `to` inclusive; empty when the range runs backwards. */
export function datesBetween(from: string, to: string): string[] {
  const dates: string[] = []
  for (let date = from; date <= to; date = shiftDate(date, 1)) dates.push(date)
  return dates
}

/** A "YYYY-MM-DD" that the browser's date input and our arithmetic both accept. */
export function isCalendarDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && shiftDate(value, 0) === value
}
