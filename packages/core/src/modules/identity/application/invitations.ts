import { BusinessRuleError, NotFoundError, UnauthenticatedError } from '../../../errors'
import { recordAudit } from '../../audit'
import { AUTH_POLICY } from '../domain/auth-policy'
import { InvalidLinkError, TooManyAttemptsError } from '../domain/errors'
import { generateOpaqueToken, hashOpaqueToken } from '../domain/tokens'
import { displayNameOf, type AuthUser } from '../domain/types'
import { invitationEmail } from '../infrastructure/email-templates'
import { newId } from '../infrastructure/ids'
import { invitationRepository } from '../infrastructure/invitation.repository'
import { mailer } from '../infrastructure/mailer'
import { passwordHasher } from '../infrastructure/password-hasher'
import { rateLimitKey, rateLimiter } from '../infrastructure/rate-limiter'
import { userRepository } from '../infrastructure/user.repository'
import { assertPasswordAllowed } from './password-rules'

const DAY_MS = 86_400_000

async function throttleRedemption(clinicId: string, ipAddress: string | null): Promise<void> {
  if (!ipAddress) return
  const limit = await rateLimiter.hit(
    rateLimitKey(clinicId, 'redeem', 'ip', ipAddress),
    AUTH_POLICY.rateLimits.tokenRedemptionPerIp,
  )
  if (!limit.allowed) throw new TooManyAttemptsError(limit.retryAfterSeconds)
}

/**
 * Emails an activation link for an account staff already created (ADR-0006). The
 * permission check belongs to the caller — user management in Phase 2 — since identity
 * sits beneath the access module and cannot depend on it.
 *
 * The link is returned for the seed and for tests. Interfaces for people must never
 * display it: whoever holds the link can set the account's password.
 */
export async function issueInvitation(
  input: {
    clinicId: string
    userId: string
    invitedBy: { id: string; name: string }
    appUrl: string
    clinicName: string
  },
  now: Date = new Date(),
): Promise<{ link: string; expiresAt: Date }> {
  const user = await userRepository.findById(input.clinicId, input.userId)
  if (!user) throw new NotFoundError('User')
  if (user.status !== 'INVITED') {
    throw new BusinessRuleError('USER_ALREADY_ACTIVE', 'This account has already been activated.')
  }

  const token = generateOpaqueToken()
  const expiresAt = new Date(now.getTime() + AUTH_POLICY.invitationTtlDays * DAY_MS)
  await invitationRepository.create(
    {
      id: newId(),
      clinicId: input.clinicId,
      userId: user.id,
      email: user.email,
      tokenHash: await hashOpaqueToken(token),
      invitedBy: input.invitedBy,
      expiresAt,
    },
    now,
  )

  // Fragment, not query string: the token never reaches a server log (see password resets).
  const link = `${input.appUrl}/accept-invite#token=${encodeURIComponent(token)}`

  // Awaited, unlike password resets: the person inviting needs to know it actually went out.
  await mailer.send(
    invitationEmail({
      to: user.email,
      firstName: user.firstName,
      clinicName: input.clinicName,
      link,
      expiresInDays: AUTH_POLICY.invitationTtlDays,
    }),
  )

  await recordAudit({
    action: 'user.invited',
    category: 'ACCESS_CONTROL',
    severity: 'NOTICE',
    clinicId: input.clinicId,
    entity: { type: 'User', id: user.id, label: user.email },
    metadata: { expiresAt: expiresAt.toISOString(), invitedBy: input.invitedBy.id },
  })

  return { link, expiresAt }
}

async function findRedeemable(
  clinicId: string,
  token: string,
  now: Date,
): Promise<{ invitationId: string; expiresAt: Date; user: AuthUser }> {
  const invitation = await invitationRepository.findUsableByHash(
    clinicId,
    await hashOpaqueToken(token),
    now,
  )
  const user = invitation ? await userRepository.findById(clinicId, invitation.userId) : null
  if (!invitation || !user || user.status !== 'INVITED') throw new InvalidLinkError()
  return { invitationId: invitation.id, expiresAt: invitation.expiresAt, user }
}

/** Who is activating, so the page can greet them before they choose a password. */
export async function previewInvitation(
  input: { clinicId: string; token: string; ipAddress: string | null },
  now: Date = new Date(),
): Promise<{ email: string; firstName: string; expiresAt: Date }> {
  await throttleRedemption(input.clinicId, input.ipAddress)
  const { user, expiresAt } = await findRedeemable(input.clinicId, input.token, now)
  return { email: user.email, firstName: user.firstName, expiresAt }
}

/** Sets the first password and activates the account. Returns the now-active user. */
export async function redeemInvitation(
  input: { clinicId: string; token: string; password: string; ipAddress: string | null },
  now: Date = new Date(),
): Promise<AuthUser> {
  const { clinicId } = input
  await throttleRedemption(clinicId, input.ipAddress)

  let redeemable: Awaited<ReturnType<typeof findRedeemable>>
  try {
    redeemable = await findRedeemable(clinicId, input.token, now)
  } catch (error) {
    await recordAudit({
      action: 'user.activation_failed',
      category: 'ACCESS_CONTROL',
      severity: 'NOTICE',
      outcome: 'FAILURE',
      clinicId,
      metadata: { reason: 'invalid_or_expired_link' },
    })
    throw error
  }

  const { user, invitationId } = redeemable
  assertPasswordAllowed(input.password, user, 'password')
  if (!(await invitationRepository.claim(clinicId, invitationId, now))) throw new InvalidLinkError()

  await userRepository.setPassword(
    clinicId,
    user.id,
    await passwordHasher.hash(input.password),
    now,
    {
      bumpTokenVersion: false,
      activate: true,
    },
  )

  await recordAudit({
    action: 'user.activated',
    category: 'ACCESS_CONTROL',
    severity: 'NOTICE',
    clinicId,
    actor: { id: user.id, type: 'USER', label: displayNameOf(user), roles: [] },
    entity: { type: 'User', id: user.id, label: user.email },
  })

  const activated = await userRepository.findById(clinicId, user.id)
  if (!activated) throw new UnauthenticatedError()
  return activated
}
