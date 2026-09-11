import type { UserStatus } from '@clinic/config'

/**
 * Where a suspended account returns to. Someone who had activated returns to ACTIVE — even
 * without a password after a forced reset, which "Forgot password?" then repairs — and someone
 * who never activated returns to INVITED, to be sent a new link.
 */
export function restoredStatus(account: {
  emailVerifiedAt: Date | null
  passwordHash: string | null
}): Extract<UserStatus, 'ACTIVE' | 'INVITED'> {
  return account.emailVerifiedAt || account.passwordHash ? 'ACTIVE' : 'INVITED'
}
