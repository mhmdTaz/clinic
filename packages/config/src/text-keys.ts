/**
 * Normalised keys for finding and matching people (section 8.14, ADR-0020).
 *
 * A regular expression can use an index only when it is anchored and case-sensitive, so
 * case and accents are folded once, on write, into keys stored beside the original values.
 * Searching "haddad" then finds "Haddad", and "helene" finds "Hélène".
 *
 * The database plugin that writes the keys and the repositories that query them both call
 * these functions, so the two cannot drift apart.
 */

/** Lower case, accents and other combining marks removed, whitespace collapsed. */
export function nameKey(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const key = value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
  return key === '' ? null : key
}

export function emailKey(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const key = value.trim().toLowerCase()
  return key === '' ? null : key
}

/** How many trailing digits identify a phone number for matching. */
export const PHONE_KEY_DIGITS = 7

/**
 * The last seven digits. "+961 3 123 456" and "03 123 456" are one number written two
 * ways, and comparing the tail matches them without a phone-number library. Two different
 * numbers can share a tail; that is acceptable because a match only raises a warning for a
 * person to confirm (ADR-0020).
 */
export function phoneKey(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const digits = value.replace(/\D/g, '')
  return digits.length < 6 ? null : digits.slice(-PHONE_KEY_DIGITS)
}

/** Upper case with spaces, dots, dashes and slashes removed: "lb 123-456" is "LB123456". */
export function nationalIdKey(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const key = value
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[\s./-]/g, '')
  return key === '' ? null : key
}

/** Escapes text for a regular expression, so a search for "a.b" matches a literal dot. */
export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
