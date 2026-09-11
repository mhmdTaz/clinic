/** 4 January 2026 was a Sunday, so adding dayOfWeek days lands on the right weekday. */
const REFERENCE_SUNDAY_UTC = Date.UTC(2026, 0, 4)
const DAY_MS = 86_400_000

/** Monday first, the convention in Lebanon and most of the region; Sunday last. */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const

/** Locale-aware weekday name for 0 = Sunday … 6 = Saturday. */
export function weekdayName(
  dayOfWeek: number,
  locale: string,
  style: 'long' | 'short' = 'long',
): string {
  return new Intl.DateTimeFormat(locale, { weekday: style, timeZone: 'UTC' }).format(
    new Date(REFERENCE_SUNDAY_UTC + dayOfWeek * DAY_MS),
  )
}
