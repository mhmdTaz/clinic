import type { AuditCategory } from '@clinic/config'

/**
 * Retention per category (section 11.6): 7 years for clinical and financial records,
 * in line with typical medical-records statutes, and 2 years for authentication and
 * system noise.
 *
 * Categories the architecture does not name default to 7 years. Keeping an entry too
 * long costs storage; deleting one too early leaves an investigation unanswerable.
 */
export const RETENTION_YEARS: Readonly<Record<AuditCategory, number>> = {
  AUTH: 2,
  SYSTEM: 2,
  ACCESS_CONTROL: 7,
  ADMIN: 7,
  CLINICAL: 7,
  FILE: 7,
  FINANCIAL: 7,
  INVENTORY: 7,
  SUPPORT: 7,
}

/**
 * Calendar years rather than multiples of 365 days, so a leap year never shortens a
 * retention period. An entry written on 29 February expires on 1 March of a non-leap
 * target year — a day longer, which errs on the side of keeping it.
 */
export function expiresAtFor(category: AuditCategory, occurredAt: Date): Date {
  const expiresAt = new Date(occurredAt.getTime())
  expiresAt.setUTCFullYear(expiresAt.getUTCFullYear() + RETENTION_YEARS[category])
  return expiresAt
}
