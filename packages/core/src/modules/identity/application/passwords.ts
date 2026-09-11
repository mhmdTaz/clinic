import { UnauthenticatedError } from '../../../errors'
import { recordAudit } from '../../audit'
import { AUTH_POLICY } from '../domain/auth-policy'
import {
  CurrentPasswordIncorrectError,
  InvalidLinkError,
  PasswordPolicyError,
  TooManyAttemptsError,
} from '../domain/errors'
import { generateOpaqueToken, hashOpaqueToken } from '../domain/tokens'
import { passwordResetEmail } from '../infrastructure/email-templates'
import { newId } from '../infrastructure/ids'
import { mailer } from '../infrastructure/mailer'
import { passwordHasher } from '../infrastructure/password-hasher'
import { passwordResetRepository } from '../infrastructure/password-reset.repository'
import { rateLimitKey, rateLimiter } from '../infrastructure/rate-limiter'
import { sessionRepository } from '../infrastructure/session.repository'
import { userRepository } from '../infrastructure/user.repository'
import { assertPasswordAllowed } from './password-rules'

/**
 * Verifies the current password and sets a new one. The token version moves, so every
 * outstanding access token is stale; the caller decides which sessions survive and
 * reissues a token for the one in use.
 */
export async function changePassword(
  input: { clinicId: string; userId: string; currentPassword: string; newPassword: string },
  now: Date = new Date(),
): Promise<void> {
  const user = await userRepository.findById(input.clinicId, input.userId)
  if (!user || !user.passwordHash || user.status !== 'ACTIVE') throw new UnauthenticatedError()

  if (!(await passwordHasher.verify(user.passwordHash, input.currentPassword))) {
    await recordAudit({
      action: 'auth.password_change_failed',
      category: 'AUTH',
      severity: 'NOTICE',
      outcome: 'FAILURE',
      clinicId: input.clinicId,
      entity: { type: 'User', id: user.id },
      metadata: { reason: 'current_password_incorrect' },
    })
    throw new CurrentPasswordIncorrectError()
  }

  assertPasswordAllowed(input.newPassword, user, 'newPassword')
  if (await passwordHasher.verify(user.passwordHash, input.newPassword)) {
    throw new PasswordPolicyError(['SAME_AS_CURRENT'], 'newPassword')
  }

  await userRepository.setPassword(
    input.clinicId,
    user.id,
    await passwordHasher.hash(input.newPassword),
    now,
    { bumpTokenVersion: true },
  )
  await passwordResetRepository.supersedeAll(input.clinicId, user.id, now)
  await recordAudit({
    action: 'auth.password_changed',
    category: 'AUTH',
    severity: 'NOTICE',
    clinicId: input.clinicId,
    entity: { type: 'User', id: user.id },
  })
}

/**
 * Always completes without error, whether or not the email matched (section 10.4), so
 * the forgot-password form cannot be used to discover which addresses have accounts.
 */
export async function requestPasswordReset(
  input: {
    clinicId: string
    email: string
    ipAddress: string | null
    appUrl: string
    clinicName: string
  },
  now: Date = new Date(),
): Promise<void> {
  const { clinicId } = input
  const email = input.email.trim().toLowerCase()

  const checks = [
    rateLimiter.hit(
      rateLimitKey(clinicId, 'reset', 'email', email),
      AUTH_POLICY.rateLimits.passwordResetPerEmail,
    ),
  ]
  if (input.ipAddress) {
    checks.push(
      rateLimiter.hit(
        rateLimitKey(clinicId, 'reset', 'ip', input.ipAddress),
        AUTH_POLICY.rateLimits.passwordResetPerIp,
      ),
    )
  }
  if ((await Promise.all(checks)).some((result) => !result.allowed)) {
    await recordAudit({
      action: 'auth.password_reset_throttled',
      category: 'AUTH',
      severity: 'WARNING',
      outcome: 'DENIED',
      clinicId,
      metadata: { email },
    })
    return
  }

  const user = await userRepository.findByEmail(clinicId, email)
  if (!user || user.status !== 'ACTIVE') {
    await recordAudit({
      action: 'auth.password_reset_requested',
      category: 'AUTH',
      outcome: 'FAILURE',
      clinicId,
      metadata: { email, matched: false },
    })
    return
  }

  const token = generateOpaqueToken()
  await passwordResetRepository.create(
    {
      id: newId(),
      clinicId,
      userId: user.id,
      tokenHash: await hashOpaqueToken(token),
      requestedIp: input.ipAddress,
      expiresAt: new Date(now.getTime() + AUTH_POLICY.passwordResetTtlMinutes * 60_000),
    },
    now,
  )

  // The token travels in the URL FRAGMENT, which browsers never send to a server: it
  // stays out of access logs, proxy logs and Referer headers.
  const link = `${input.appUrl}/reset-password#token=${encodeURIComponent(token)}`

  // Deliberately not awaited. Sending takes hundreds of milliseconds, and a matched
  // email answering visibly slower than an unmatched one would leak the same fact the
  // generic response hides.
  void mailer
    .send(
      passwordResetEmail({
        to: user.email,
        firstName: user.firstName,
        clinicName: input.clinicName,
        link,
        expiresInMinutes: AUTH_POLICY.passwordResetTtlMinutes,
      }),
    )
    .catch((error: unknown) => {
      console.error('[identity] password reset email could not be sent', { userId: user.id, error })
    })

  await recordAudit({
    action: 'auth.password_reset_requested',
    category: 'AUTH',
    clinicId,
    entity: { type: 'User', id: user.id },
    metadata: { matched: true },
  })
}

export async function resetPassword(
  input: { clinicId: string; token: string; newPassword: string; ipAddress: string | null },
  now: Date = new Date(),
): Promise<void> {
  const { clinicId } = input

  if (input.ipAddress) {
    const limit = await rateLimiter.hit(
      rateLimitKey(clinicId, 'redeem', 'ip', input.ipAddress),
      AUTH_POLICY.rateLimits.tokenRedemptionPerIp,
    )
    if (!limit.allowed) throw new TooManyAttemptsError(limit.retryAfterSeconds)
  }

  const record = await passwordResetRepository.findUsableByHash(
    clinicId,
    await hashOpaqueToken(input.token),
    now,
  )
  const user = record ? await userRepository.findById(clinicId, record.userId) : null
  if (!record || !user || user.status !== 'ACTIVE') {
    await recordAudit({
      action: 'auth.password_reset_failed',
      category: 'AUTH',
      severity: 'NOTICE',
      outcome: 'FAILURE',
      clinicId,
      metadata: { reason: 'invalid_or_expired_link' },
    })
    throw new InvalidLinkError()
  }

  // The reset request carries it as `password` (ResetPasswordRequest), whatever it is called here.
  assertPasswordAllowed(input.newPassword, user, 'password')
  if (!(await passwordResetRepository.claim(clinicId, record.id, now))) throw new InvalidLinkError()

  await userRepository.setPassword(
    clinicId,
    user.id,
    await passwordHasher.hash(input.newPassword),
    now,
    { bumpTokenVersion: true },
  )
  await passwordResetRepository.supersedeAll(clinicId, user.id, now)
  // Whoever triggered the reset may not be the only one who knew the old password.
  await sessionRepository.revokeAllForUser(clinicId, user.id, 'password_reset', now)

  await recordAudit({
    action: 'auth.password_reset_completed',
    category: 'AUTH',
    severity: 'NOTICE',
    clinicId,
    entity: { type: 'User', id: user.id },
  })
}
