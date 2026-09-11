import type { UserStatus } from '@clinic/config'
import { BusinessRuleError, ConflictError, NotFoundError } from '../../../errors'
import type { Page } from '../../../pagination'
import type { Transaction } from '../../../transaction'
import { AUTH_POLICY } from '../domain/auth-policy'
import { generateOpaqueToken, hashOpaqueToken } from '../domain/tokens'
import type { AuthUser } from '../domain/types'
import { forcedPasswordResetEmail } from '../infrastructure/email-templates'
import { newId } from '../infrastructure/ids'
import { invitationRepository } from '../infrastructure/invitation.repository'
import { mailer } from '../infrastructure/mailer'
import { passwordResetRepository } from '../infrastructure/password-reset.repository'
import { userRepository, type UserListFilter } from '../infrastructure/user.repository'
import { endAllSessions } from './sessions'

/**
 * Account administration primitives. Identity sits beneath access (section 5.2), so nothing here
 * checks a permission or writes an intent-level audit entry: user management, patient
 * registration and doctor onboarding call these and do both.
 */

export async function createAccount(
  input: {
    clinicId: string
    email: string
    firstName: string
    lastName: string
    phone: string | null
    roleIds: readonly string[]
    assignedBy: string | null
  },
  now: Date = new Date(),
  tx?: Transaction,
): Promise<AuthUser> {
  // The unique index is the real guard; this answers the common case with a clear message.
  if (await userRepository.findByEmail(input.clinicId, input.email)) {
    throw new ConflictError('EMAIL_TAKEN', 'Another account already uses this email address.', [
      { field: 'email', issue: 'EMAIL_TAKEN' },
    ])
  }
  return userRepository.create(
    {
      clinicId: input.clinicId,
      email: input.email,
      firstName: input.firstName,
      lastName: input.lastName,
      phone: input.phone,
      roles: input.roleIds.map((roleId) => ({ roleId, assignedBy: input.assignedBy })),
    },
    now,
    tx,
  )
}

export function listAccounts(clinicId: string, filter: UserListFilter): Promise<Page<AuthUser>> {
  return userRepository.list(clinicId, filter)
}

export function findAccounts(clinicId: string, ids: readonly string[]): Promise<AuthUser[]> {
  return userRepository.findManyByIds(clinicId, ids)
}

/**
 * Name and phone can always change. The email can change only before activation: afterwards it
 * is the sign-in identity, and a changed address with no confirmation is how accounts are taken
 * over. Changing it also retires links already sent to the old address.
 */
export async function updateAccountDetails(
  clinicId: string,
  userId: string,
  patch: { firstName: string; lastName: string; phone: string | null; email: string },
  now: Date = new Date(),
): Promise<{ user: AuthUser; emailChanged: boolean }> {
  const user = await userRepository.findById(clinicId, userId)
  if (!user) throw new NotFoundError('User')

  const email = patch.email.trim().toLowerCase()
  const emailChanged = email !== user.email
  if (emailChanged && user.status !== 'INVITED') {
    throw new BusinessRuleError('EMAIL_LOCKED', 'An activated account keeps its email address.', [
      { field: 'email', issue: 'EMAIL_LOCKED' },
    ])
  }
  if (emailChanged) await invitationRepository.revokeForUser(clinicId, userId, now)

  const updated = await userRepository.updateDetails(clinicId, userId, {
    firstName: patch.firstName,
    lastName: patch.lastName,
    phone: patch.phone,
    ...(emailChanged ? { email } : {}),
  })
  if (!updated) throw new NotFoundError('User')
  return { user: updated, emailChanged }
}

/**
 * A suspension takes effect on the user's next request: every session is revoked, the token
 * version moves so outstanding access tokens die, and waiting activation links stop working.
 */
export async function setAccountStatus(
  clinicId: string,
  userId: string,
  status: Extract<UserStatus, 'ACTIVE' | 'INVITED' | 'SUSPENDED'>,
  now: Date = new Date(),
): Promise<AuthUser> {
  const updated = await userRepository.setStatus(clinicId, userId, status)
  if (!updated) throw new NotFoundError('User')
  if (status === 'SUSPENDED') {
    await endAllSessions(clinicId, userId, 'suspended', {}, now)
    await invitationRepository.revokeForUser(clinicId, userId, now)
  }
  return updated
}

export async function setAccountRoles(
  clinicId: string,
  userId: string,
  roleIds: readonly string[],
  assignment: { assignedBy: string | null; now: Date },
  tx?: Transaction,
): Promise<AuthUser> {
  const updated = await userRepository.setRoles(clinicId, userId, roleIds, assignment, tx)
  if (!updated) throw new NotFoundError('User')
  return updated
}

/**
 * The old password stops working immediately, every device is signed out, and a single-use
 * link to choose a new one is emailed. Awaited, unlike a self-service reset: the administrator
 * needs to know it was sent.
 */
export async function forcePasswordReset(
  input: { clinicId: string; userId: string; appUrl: string; clinicName: string },
  now: Date = new Date(),
): Promise<{ expiresAt: Date }> {
  const user = await userRepository.findById(input.clinicId, input.userId)
  if (!user) throw new NotFoundError('User')
  if (user.status !== 'ACTIVE') {
    throw new BusinessRuleError(
      'ACCOUNT_NOT_ACTIVE',
      'Only an active account can be sent a password reset.',
    )
  }

  await userRepository.clearPassword(input.clinicId, user.id)
  await endAllSessions(input.clinicId, user.id, 'password_reset_forced', {}, now)

  const token = generateOpaqueToken()
  const expiresAt = new Date(now.getTime() + AUTH_POLICY.passwordResetTtlMinutes * 60_000)
  await passwordResetRepository.create(
    {
      id: newId(),
      clinicId: input.clinicId,
      userId: user.id,
      tokenHash: await hashOpaqueToken(token),
      requestedIp: null,
      expiresAt,
    },
    now,
  )

  await mailer.send(
    forcedPasswordResetEmail({
      to: user.email,
      firstName: user.firstName,
      clinicName: input.clinicName,
      link: `${input.appUrl}/reset-password#token=${encodeURIComponent(token)}`,
      expiresInMinutes: AUTH_POLICY.passwordResetTtlMinutes,
    }),
  )
  return { expiresAt }
}

export function latestInvitation(
  clinicId: string,
  userId: string,
  now: Date = new Date(),
): Promise<{ sentAt: Date; expiresAt: Date } | null> {
  return invitationRepository.findLatestUsable(clinicId, userId, now)
}
