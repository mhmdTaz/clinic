import { nameKey, nationalIdKey, phoneKey } from '@clinic/config'

/** Human-facing record numbers, allocated from the counters collection (section 8.15). */
export const MRN_DIGITS = 6

export function formatMrn(sequence: number): string {
  return `MRN-${String(sequence).padStart(MRN_DIGITS, '0')}`
}

/**
 * A birth date after today — in the clinic's timezone, not UTC — or before 1900 is a typing
 * mistake, not a patient.
 */
export function birthDateIssue(
  dateOfBirth: string | null,
  today: string,
): 'IN_FUTURE' | 'TOO_EARLY' | null {
  if (dateOfBirth === null) return null
  if (dateOfBirth > today) return 'IN_FUTURE'
  if (dateOfBirth < '1900-01-01') return 'TOO_EARLY'
  return null
}

/** How the directory reads what someone typed into its search box. */
export type PatientQuery =
  | { kind: 'mrn'; value: string }
  | { kind: 'phone'; value: string }
  | {
      kind: 'text'
      name: string | null
      first: string | null
      rest: string | null
      nationalId: string | null
    }

/**
 * "MRN-000142", "mrn 142" and "142" find a record number; seven or more digits typed as a
 * phone number find a phone; anything else searches names — whole, and split into first and
 * last — plus an exact national ID when the text has digits in it.
 */
export function parsePatientQuery(q: string | null | undefined): PatientQuery | null {
  const text = q?.trim() ?? ''
  if (text === '') return null

  const prefixed = /^mrn[-\s]*(\d+)$/i.exec(text)
  if (prefixed) return { kind: 'mrn', value: formatMrn(Number(prefixed[1])) }
  if (/^\d{1,6}$/.test(text)) return { kind: 'mrn', value: formatMrn(Number(text)) }

  const key = phoneKey(text)
  if (key && /^[\d\s+().\-/]+$/.test(text) && text.replace(/\D/g, '').length >= 7) {
    return { kind: 'phone', value: key }
  }

  const name = nameKey(text)
  const [first, ...rest] = name?.split(' ') ?? []
  return {
    kind: 'text',
    name,
    first: rest.length > 0 ? (first ?? null) : null,
    rest: rest.length > 0 ? rest.join(' ') : null,
    nationalId: /\d/.test(text) ? nationalIdKey(text) : null,
  }
}
