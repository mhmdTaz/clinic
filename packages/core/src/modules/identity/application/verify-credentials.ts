import { recordAudit } from '../../audit'
import { AUTH_POLICY } from '../domain/auth-policy'
import {
  AccountDisabledError,
  InvalidCredentialsError,
  TooManyAttemptsError,
} from '../domain/errors'
import { LOCKOUT_POLICY, isLocked, lockedUntilAfter, secondsUntil } from '../domain/lockout'
import type { AuthUser } from '../domain/types'
import { passwordHasher } from '../infrastructure/password-hasher'
import { rateLimitKey, rateLimiter } from '../infrastructure/rate-limiter'
import { userRepository } from '../infrastructure/user.repository'

export interface CredentialAttempt {
  clinicId: string
  email: string
  password: string
  /** Null when the client address cannot be trusted; the per-IP limit is then skipped. */
  ipAddress: string | null
}

/**
 * Email and password in, a verified user out — or one of three deliberately vague
 * errors (section 10.4). Every path that rejects spends the time of a real hash
 * verification, so response time does not reveal which emails have accounts.
 */
export async function verifyCredentials(
  attempt: CredentialAttempt,
  now: Date = new Date(),
): Promise<AuthUser> {
  const { clinicId } = attempt
  const email = attempt.email.trim().toLowerCase()
  const emailKey = rateLimitKey(clinicId, 'login', 'email', email)

  const checks = [rateLimiter.hit(emailKey, AUTH_POLICY.rateLimits.loginPerEmail)]
  if (attempt.ipAddress) {
    checks.push(
      rateLimiter.hit(
        rateLimitKey(clinicId, 'login', 'ip', attempt.ipAddress),
        AUTH_POLICY.rateLimits.loginPerIp,
      ),
    )
  }
  const limited = (await Promise.all(checks)).filter((result) => !result.allowed)
  if (limited.length > 0) {
    await recordAudit({
      action: 'auth.login_throttled',
      category: 'AUTH',
      severity: 'WARNING',
      outcome: 'DENIED',
      clinicId,
      metadata: { email },
    })
    throw new TooManyAttemptsError(Math.max(...limited.map((result) => result.retryAfterSeconds)))
  }

  const user = await userRepository.findByEmail(clinicId, email)

  if (!user || !user.passwordHash) {
    await passwordHasher.burnVerificationTime(attempt.password)
    await recordAudit({
      action: 'auth.login_failed',
      category: 'AUTH',
      severity: 'NOTICE',
      outcome: 'FAILURE',
      clinicId,
      entity: user ? { type: 'User', id: user.id } : undefined,
      metadata: { email, reason: user ? 'no_password_set' : 'unknown_email' },
    })
    throw new InvalidCredentialsError()
  }

  if (isLocked(user.lockedUntil, now)) {
    await passwordHasher.burnVerificationTime(attempt.password)
    await recordAudit({
      action: 'auth.login_blocked',
      category: 'AUTH',
      severity: 'WARNING',
      outcome: 'DENIED',
      clinicId,
      entity: { type: 'User', id: user.id },
      metadata: { email, reason: 'locked', lockedUntil: user.lockedUntil?.toISOString() },
    })
    throw new TooManyAttemptsError(secondsUntil(user.lockedUntil ?? now, now))
  }

  if (!(await passwordHasher.verify(user.passwordHash, attempt.password))) {
    const forgiveBefore = new Date(now.getTime() - LOCKOUT_POLICY.forgiveAfterHours * 3_600_000)
    const failures = await userRepository.recordFailedLogin(clinicId, user.id, now, forgiveBefore)
    const lockedUntil = lockedUntilAfter(failures, now)
    if (lockedUntil) await userRepository.applyLock(clinicId, user.id, lockedUntil)

    await recordAudit({
      action: 'auth.login_failed',
      category: 'AUTH',
      severity: lockedUntil ? 'WARNING' : 'NOTICE',
      outcome: 'FAILURE',
      clinicId,
      entity: { type: 'User', id: user.id },
      metadata: {
        email,
        reason: 'wrong_password',
        consecutiveFailures: failures,
        lockedUntil: lockedUntil?.toISOString() ?? null,
      },
    })
    throw new InvalidCredentialsError()
  }

  // The password is right. Only now is it safe to say anything about the account.
  if (user.status !== 'ACTIVE') {
    await recordAudit({
      action: 'auth.login_blocked',
      category: 'AUTH',
      severity: 'NOTICE',
      outcome: 'DENIED',
      clinicId,
      entity: { type: 'User', id: user.id },
      metadata: { email, reason: `status_${user.status.toLowerCase()}` },
    })
    if (user.status === 'INVITED') throw new InvalidCredentialsError()
    throw new AccountDisabledError()
  }

  if (passwordHasher.needsRehash(user.passwordHash)) {
    await userRepository.replaceHash(clinicId, user.id, await passwordHasher.hash(attempt.password))
  }
  await userRepository.recordSuccessfulLogin(clinicId, user.id, now)
  // A success clears the per-email window. The per-IP window stays: one machine
  // succeeding on one account says nothing about the other accounts it is trying.
  await rateLimiter.reset(emailKey)

  return user
}
