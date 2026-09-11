import { PasswordPolicyError } from '../domain/errors'
import { assessPassword } from '../domain/password-policy'
import type { AuthUser } from '../domain/types'

/**
 * Checked before any single-use link is consumed, so a rejected password never burns it.
 *
 * `field` is the request field that carried the password — `password` on a reset or an
 * activation, `newPassword` on a change. Forms show each reason beside the input it names;
 * name the wrong field and the reason silently collapses into a generic "does not meet the
 * requirements", which is why there is no default.
 */
export function assertPasswordAllowed(
  password: string,
  user: Pick<AuthUser, 'email' | 'firstName' | 'lastName'>,
  field: 'password' | 'newPassword',
): void {
  const issues = assessPassword(password, user)
  if (issues.length > 0) throw new PasswordPolicyError(issues, field)
}
