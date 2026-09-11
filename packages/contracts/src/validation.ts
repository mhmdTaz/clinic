import type { ZodIssue } from 'zod'

/** A message written as a code — "TOO_SHORT", "CLOSES_BEFORE_OPENS" — is already translatable. */
const CODE = /^[A-Z][A-Z0-9_]*$/

/**
 * A stable, translatable code for one validation issue (section 13.6).
 *
 * Rules written for this product carry a code as their message. Zod's built-in checks carry
 * English sentences instead, which a form cannot translate, so those are mapped here — once,
 * for the server's error envelope and the forms' client-side check alike.
 */
export function issueCode(issue: ZodIssue): string {
  if (CODE.test(issue.message)) return issue.message

  switch (issue.code) {
    case 'invalid_type':
      return issue.received === 'undefined' || issue.received === 'null' ? 'REQUIRED' : 'INVALID'
    case 'too_small':
      if (issue.type === 'string' || issue.type === 'array') {
        return Number(issue.minimum) <= 1 ? 'REQUIRED' : 'TOO_SHORT'
      }
      return 'TOO_SMALL'
    case 'too_big':
      return issue.type === 'string' || issue.type === 'array' ? 'TOO_LONG' : 'TOO_LARGE'
    case 'invalid_string':
      return issue.validation === 'email' ? 'INVALID_EMAIL' : 'INVALID_FORMAT'
    case 'invalid_enum_value':
      return 'INVALID_OPTION'
    default:
      return 'INVALID'
  }
}

/** "contact.phone", "workingHours.2.opensAt" — the same path a form field is named by. */
export function issuePath(issue: ZodIssue): string {
  return issue.path.join('.') || '(body)'
}
