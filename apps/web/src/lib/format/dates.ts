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
