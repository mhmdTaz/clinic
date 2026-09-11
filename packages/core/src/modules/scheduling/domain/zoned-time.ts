/**
 * Clinic-local calendar arithmetic.
 *
 * A clinic runs in one timezone (ADR-0010), so scheduling is decided in wall-clock terms —
 * "Tuesday at 09:00" — and stored as an instant. These are the two conversions that needs, plus
 * the calendar-date walking the day columns need.
 *
 * Written with Intl rather than a date library: the runtime already carries the IANA database,
 * and what is needed here is small enough to test directly.
 */

export interface LocalMoment {
  /** "2026-09-14" */
  date: string
  /** "09:05" */
  time: string
  /** 0 = Sunday */
  dayOfWeek: number
}

const FORMATTER_CACHE = new Map<string, Intl.DateTimeFormat>()

function formatter(timeZone: string): Intl.DateTimeFormat {
  let cached = FORMATTER_CACHE.get(timeZone)
  if (!cached) {
    cached = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
    FORMATTER_CACHE.set(timeZone, cached)
  }
  return cached
}

interface ClockParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

function partsOf(instant: Date, timeZone: string): ClockParts {
  const parts = formatter(timeZone).formatToParts(instant)
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? '0')
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
    second: value('second'),
  }
}

const pad = (value: number) => String(value).padStart(2, '0')

/** The clinic's wall clock at an instant. */
export function localMoment(instant: Date, timeZone: string): LocalMoment {
  const parts = partsOf(instant, timeZone)
  const date = `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`
  return { date, time: `${pad(parts.hour)}:${pad(parts.minute)}`, dayOfWeek: weekdayOf(date) }
}

/** How far the zone is from UTC at that instant, in milliseconds. Handles DST by construction. */
export function offsetMsAt(instant: Date, timeZone: string): number {
  const parts = partsOf(instant, timeZone)
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  )
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000
}

/**
 * The instant a clinic-local date and time refer to.
 *
 * Across a DST change the offset before and after disagree; the second reading settles it. A
 * local time that does not exist (the hour a clock skips) resolves to the instant the clock
 * jumps to, and one that happens twice resolves to the first.
 */
export function instantOf(date: string, time: string, timeZone: string): Date {
  const [year, month, day] = date.split('-').map(Number)
  const [hour, minute] = time.split(':').map(Number)
  const guess = Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1, hour ?? 0, minute ?? 0)
  const firstOffset = offsetMsAt(new Date(guess), timeZone)
  const candidate = new Date(guess - firstOffset)
  const secondOffset = offsetMsAt(candidate, timeZone)
  return firstOffset === secondOffset ? candidate : new Date(guess - secondOffset)
}

/** 0 = Sunday, from the calendar date alone — no zone involved. */
export function weekdayOf(date: string): number {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1)).getUTCDay()
}

/** Calendar dates from `from` to `to`, both ends included. */
export function eachDate(from: string, to: string): string[] {
  const dates: string[] = []
  const [year, month, day] = from.split('-').map(Number)
  const cursor = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1))
  while (dates.length < 400) {
    const date = `${cursor.getUTCFullYear()}-${pad(cursor.getUTCMonth() + 1)}-${pad(cursor.getUTCDate())}`
    if (date > to) break
    dates.push(date)
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return dates
}

export function addMinutes(instant: Date, minutes: number): Date {
  return new Date(instant.getTime() + minutes * 60_000)
}

/** The calendar date after this one, so a day range can be read as [from, to) on instants. */
export function nextDate(date: string): string {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number)
  const cursor = new Date(Date.UTC(year, month - 1, day))
  cursor.setUTCDate(cursor.getUTCDate() + 1)
  return `${cursor.getUTCFullYear()}-${pad(cursor.getUTCMonth() + 1)}-${pad(cursor.getUTCDate())}`
}
