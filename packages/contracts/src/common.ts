import { z } from 'zod'
import { EmailAddress } from './auth'

/**
 * Building blocks shared by every contract. Closed sets mirror the unions in @clinic/config;
 * contracts stay dependency-free so the mobile app can take them as they are, and a test in
 * @clinic/core fails if the two lists ever disagree.
 */

/** An emptied optional field means "no value": it is stored as null, never as "". */
export function blankToNull(value: unknown): unknown {
  return typeof value === 'string' && value.trim() === '' ? null : value
}

export const requiredText = (max: number) => z.string().trim().min(1).max(max)

export const nullableText = (max: number) =>
  z.preprocess(blankToNull, z.string().trim().max(max).nullable())

export const nullableEmail = z.preprocess(blankToNull, EmailAddress.nullable())

/** A whole number typed into a form arrives as text; blank means null. */
export const nullableInteger = (min: number, max: number) =>
  z.preprocess((value) => {
    const blank = blankToNull(value)
    return typeof blank === 'string' ? Number(blank) : blank
  }, z.number().int().min(min).max(max).nullable())

export const IdParam = z.string().min(1).max(64)

function isRealDate(value: string): boolean {
  const [year, month, day] = value.split('-').map(Number) as [number, number, number]
  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  )
}

/**
 * A calendar date, "1990-04-17" — never an instant. Stored as midnight UTC, a birthday
 * renders as the day before anywhere west of Greenwich.
 */
export const LocalDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'INVALID_DATE')
  .refine(isRealDate, 'INVALID_DATE')

export const nullableLocalDate = z.preprocess(blankToNull, LocalDate.nullable())

/** A wall-clock time, "09:30", local to the clinic. */
export const LocalTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'INVALID_TIME')

/** Indexes of ranges that overlap another range on the same weekday. "HH:MM" sorts as text. */
export function overlappingDayRanges(
  entries: ReadonlyArray<{ dayOfWeek: number; from: string; to: string }>,
): number[] {
  const overlapping = new Set<number>()
  entries.forEach((a, i) => {
    entries.forEach((b, j) => {
      if (i < j && a.dayOfWeek === b.dayOfWeek && a.from < b.to && b.from < a.to) {
        overlapping.add(i)
        overlapping.add(j)
      }
    })
  })
  return [...overlapping].sort((x, y) => x - y)
}

/** Today's calendar date in a timezone — "today" in Beirut is not "today" in UTC after 21:00. */
export function localDateIn(timeZone: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

export function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value })
    return true
  } catch {
    return false
  }
}

export const IanaTimezone = z.string().min(1).max(64).refine(isTimeZone, 'INVALID_TIMEZONE')

/** Codes the runtime names that are not countries: the EU, the UN, pseudo-locales, "Unknown". */
export const NON_COUNTRY_REGIONS: ReadonlySet<string> = new Set([
  'EU',
  'EZ',
  'QO',
  'UN',
  'XA',
  'XB',
  'ZZ',
])

/** ISO 3166-1 alpha-2, checked against the runtime's own list of regions. */
export function isRegionCode(value: string): boolean {
  if (!/^[A-Z]{2}$/.test(value) || NON_COUNTRY_REGIONS.has(value)) return false
  try {
    const name = new Intl.DisplayNames(['en'], { type: 'region' }).of(value)
    return Boolean(name) && name !== value
  } catch {
    return false
  }
}

export const CountryCode = z.string().trim().toUpperCase().refine(isRegionCode, 'INVALID_COUNTRY')
export const nullableCountry = z.preprocess(blankToNull, CountryCode.nullable())

/** An amount as a decimal string, "45.00" — a JSON number cannot hold cents exactly (9.2). */
export const MoneyAmount = z
  .string()
  .trim()
  .regex(/^\d{1,9}(\.\d{1,3})?$/, 'INVALID_AMOUNT')

export const Money = z.object({ amount: z.string(), currency: z.string() })
export type Money = z.infer<typeof Money>

export const Gender = z.enum(['FEMALE', 'MALE', 'OTHER', 'UNDISCLOSED'])
export type Gender = z.infer<typeof Gender>

export const BloodType = z.enum(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'UNKNOWN'])
export type BloodType = z.infer<typeof BloodType>

export const Currency = z.enum([
  'USD',
  'EUR',
  'LBP',
  'GBP',
  'AED',
  'SAR',
  'QAR',
  'KWD',
  'JOD',
  'EGP',
  'TRY',
  'CAD',
  'AUD',
])
export type Currency = z.infer<typeof Currency>

export const Locale = z.enum(['en'])

export const UserStatus = z.enum(['INVITED', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED'])
export type UserStatus = z.infer<typeof UserStatus>

export const SLOT_MINUTES = [10, 15, 20, 30, 45, 60] as const

/** A select sends "30"; the contract wants 30. */
export const SlotMinutes = z.preprocess(
  (value) => (typeof value === 'string' && value !== '' ? Number(value) : value),
  z
    .number()
    .int()
    .refine((value) => (SLOT_MINUTES as readonly number[]).includes(value), 'INVALID_OPTION'),
)

export const PersonRef = z.object({ id: z.string().nullable(), name: z.string() })
export type PersonRef = z.infer<typeof PersonRef>

/**
 * Ids in a query string, comma-separated: `?appointmentIds=a1,a2,a3`.
 *
 * Comma-separated rather than a repeated parameter because the API reads a query into one object
 * (`Object.fromEntries`), where a repeated key keeps only its last value — a filter that silently
 * dropped all but one id would be worse than none.
 */
export const idList = (max: number) =>
  z.preprocess(
    (value) =>
      typeof value === 'string'
        ? value
            .split(',')
            .map((part) => part.trim())
            .filter((part) => part !== '')
        : value,
    z.array(z.string().max(64)).min(1).max(max),
  )
