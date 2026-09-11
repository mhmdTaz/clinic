import { AUTH_POLICY } from './auth-policy'

export const PASSWORD_ISSUES = [
  'TOO_SHORT',
  'TOO_LONG',
  'TOO_COMMON',
  'TOO_REPETITIVE',
  'CONTAINS_PERSONAL_INFO',
  /** Reported by the change-password flow, which alone holds the current hash. */
  'SAME_AS_CURRENT',
] as const
export type PasswordIssue = (typeof PASSWORD_ISSUES)[number]

export interface PersonalInfo {
  email?: string | null
  firstName?: string | null
  lastName?: string | null
}

/** Frequently-breached passwords long enough to pass the length rule on their own. */
const COMMON_PASSWORDS = new Set([
  '000000000000',
  '111111111111',
  '123123123123',
  '123456789012',
  '1234567890123',
  '12345678901234',
  '1234qwerasdf',
  '1q2w3e4r5t6y',
  '1qaz2wsx3edc',
  'abc123456789',
  'asdfghjkl123',
  'qwerty123456',
  'qwertyqwerty',
  'qwertyuiop12',
  'qwertyuiopas',
  'zaq12wsxcde3',
  'zxcvbnm12345',
  'p@ssw0rd1234',
  'p@ssword1234',
])

/**
 * Words that, padded with digits and symbols, make up a large share of breached
 * passwords: "Password2026!", "Welcome@12345". Matched on the letters alone.
 */
const COMMON_BASE_WORDS = new Set([
  'admin',
  'administrator',
  'baseball',
  'changeme',
  'clinic',
  'default',
  'doctor',
  'dragon',
  'football',
  'hospital',
  'iloveyou',
  'letmein',
  'login',
  'monkey',
  'passw',
  'password',
  'patient',
  'princess',
  'qwerty',
  'qwertyuiop',
  'secret',
  'sunshine',
  'superman',
  'trustno',
  'welcome',
  'whatever',
])

/**
 * Length plus a common-password check, and nothing else (section 10.4). No composition
 * rules ("one symbol, one digit") and no forced rotation: both push people toward
 * weaker passwords that end up written on a sticky note.
 *
 * Length is counted in Unicode code points rather than UTF-16 units, so a password in
 * Arabic script or made of emoji is measured the way a person would count it.
 */
export function assessPassword(password: string, personal: PersonalInfo = {}): PasswordIssue[] {
  const issues: PasswordIssue[] = []
  const length = [...password].length

  if (length < AUTH_POLICY.password.minLength) issues.push('TOO_SHORT')
  if (length > AUTH_POLICY.password.maxLength) issues.push('TOO_LONG')

  const lower = password.toLowerCase()
  const lettersOnly = lower.replace(/[^a-z]/g, '')
  if (COMMON_PASSWORDS.has(lower) || COMMON_BASE_WORDS.has(lettersOnly)) {
    issues.push('TOO_COMMON')
  }

  if (new Set(password).size < 4) issues.push('TOO_REPETITIVE')

  const fragments = [personal.email?.split('@')[0], personal.firstName, personal.lastName]
    .map((fragment) => fragment?.trim().toLowerCase() ?? '')
    .filter((fragment) => fragment.length >= 4)
  if (fragments.some((fragment) => lower.includes(fragment))) {
    issues.push('CONTAINS_PERSONAL_INFO')
  }

  return issues
}
