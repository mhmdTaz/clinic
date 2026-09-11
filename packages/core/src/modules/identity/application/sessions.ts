import { UnauthenticatedError } from '../../../errors'
import { recordAudit } from '../../audit'
import { AUTH_POLICY } from '../domain/auth-policy'
import { generateOpaqueToken, hashOpaqueToken } from '../domain/tokens'
import type { AuthSession, AuthUser } from '../domain/types'
import { newId } from '../infrastructure/ids'
import { sessionRepository } from '../infrastructure/session.repository'
import { userRepository } from '../infrastructure/user.repository'

export interface DeviceInfo {
  name: string | null
  userAgent: string | null
  ipAddress: string | null
}

export interface IssuedRefreshToken {
  token: string
  /** The session id a user sees: stable across every rotation. */
  familyId: string
  expiresAt: Date
}

const DAY_MS = 86_400_000

async function issueRefreshToken(
  input: {
    clinicId: string
    userId: string
    familyId: string
    startedAt: Date
    device: DeviceInfo
  },
  now: Date,
): Promise<IssuedRefreshToken & { recordId: string }> {
  const token = generateOpaqueToken()
  const expiresAt = new Date(now.getTime() + AUTH_POLICY.refreshTokenTtlDays * DAY_MS)
  const record = await sessionRepository.create({
    id: newId(),
    clinicId: input.clinicId,
    userId: input.userId,
    familyId: input.familyId,
    tokenHash: await hashOpaqueToken(token),
    device: input.device,
    startedAt: input.startedAt,
    expiresAt,
    now,
  })
  return { token, familyId: input.familyId, expiresAt, recordId: record.id }
}

/** A new sign-in: a new family. */
export async function startSession(
  input: { clinicId: string; userId: string; device: DeviceInfo },
  now: Date = new Date(),
): Promise<IssuedRefreshToken> {
  const issued = await issueRefreshToken({ ...input, familyId: newId(), startedAt: now }, now)
  return { token: issued.token, familyId: issued.familyId, expiresAt: issued.expiresAt }
}

/**
 * A token rotated away is being presented again. Within the grace window that is two
 * tabs refreshing at once. Outside it, the token was copied — so the whole family ends,
 * the thief's copy and the real user's current token alike, and the event is CRITICAL.
 */
async function assertWithinReuseGrace(
  clinicId: string,
  session: AuthSession,
  now: Date,
): Promise<void> {
  const secondsSinceRotation = (now.getTime() - (session.rotatedAt?.getTime() ?? 0)) / 1000
  if (secondsSinceRotation <= AUTH_POLICY.refreshReuseGraceSeconds) return

  await sessionRepository.revokeFamily(clinicId, session.familyId, 'refresh_token_reused', now)
  await recordAudit({
    action: 'auth.refresh_token_reused',
    category: 'AUTH',
    severity: 'CRITICAL',
    outcome: 'DENIED',
    clinicId,
    entity: { type: 'User', id: session.userId },
    metadata: {
      sessionId: session.familyId,
      secondsSinceRotation: Math.round(secondsSinceRotation),
    },
  })
  throw new UnauthenticatedError('This session has ended. Please sign in again.')
}

/**
 * Exchanges a refresh token for a new one in the same family (section 10.4).
 * The presented token can never be used again.
 */
export async function rotateSession(
  input: { clinicId: string; presentedToken: string; device: DeviceInfo },
  now: Date = new Date(),
): Promise<{ user: AuthUser; refresh: IssuedRefreshToken }> {
  const { clinicId } = input
  const presented = await sessionRepository.findByHash(
    clinicId,
    await hashOpaqueToken(input.presentedToken),
  )
  if (!presented || presented.revokedAt || presented.expiresAt.getTime() <= now.getTime()) {
    throw new UnauthenticatedError()
  }

  let rotatedFrom: string | null = null
  if (presented.rotatedAt) {
    await assertWithinReuseGrace(clinicId, presented, now)
  } else if (await sessionRepository.claimRotation(clinicId, presented.id, now)) {
    rotatedFrom = presented.id
  } else {
    // Lost the race to a concurrent refresh of this exact token. Re-read to learn why:
    // it may have been rotated a moment ago, or revoked, in which case nothing is issued.
    const latest = await sessionRepository.findById(clinicId, presented.id)
    if (!latest || latest.revokedAt || !latest.rotatedAt) throw new UnauthenticatedError()
    await assertWithinReuseGrace(clinicId, latest, now)
  }

  const user = await userRepository.findById(clinicId, presented.userId)
  if (!user || user.status !== 'ACTIVE') {
    await sessionRepository.revokeFamily(clinicId, presented.familyId, 'account_inactive', now)
    throw new UnauthenticatedError()
  }

  const issued = await issueRefreshToken(
    {
      clinicId,
      userId: user.id,
      familyId: presented.familyId,
      startedAt: presented.startedAt,
      device: {
        name: presented.deviceName,
        userAgent: input.device.userAgent ?? presented.userAgent,
        ipAddress: input.device.ipAddress ?? presented.ipAddress,
      },
    },
    now,
  )
  if (rotatedFrom) await sessionRepository.linkReplacement(clinicId, rotatedFrom, issued.recordId)

  return {
    user,
    refresh: { token: issued.token, familyId: issued.familyId, expiresAt: issued.expiresAt },
  }
}

export async function endSessionFamily(
  clinicId: string,
  familyId: string,
  reason: string,
  now: Date = new Date(),
): Promise<void> {
  await sessionRepository.revokeFamily(clinicId, familyId, reason, now)
}

export async function endSessionByToken(
  clinicId: string,
  presentedToken: string,
  reason: string,
  now: Date = new Date(),
): Promise<AuthSession | null> {
  const session = await sessionRepository.findByHash(
    clinicId,
    await hashOpaqueToken(presentedToken),
  )
  if (!session) return null
  await sessionRepository.revokeFamily(clinicId, session.familyId, reason, now)
  return session
}

/**
 * Ends every session a user has, optionally sparing the current one. With nothing
 * spared the token version moves too: the family check already rejects the old access
 * tokens, and this makes sure no other path could accept one either.
 */
export async function endAllSessions(
  clinicId: string,
  userId: string,
  reason: string,
  options: { exceptFamilyId?: string } = {},
  now: Date = new Date(),
): Promise<void> {
  await sessionRepository.revokeAllForUser(clinicId, userId, reason, now, options.exceptFamilyId)
  if (!options.exceptFamilyId) await userRepository.bumpTokenVersion(clinicId, userId)
}

export function isSessionActive(
  clinicId: string,
  familyId: string,
  now: Date = new Date(),
): Promise<boolean> {
  return sessionRepository.isFamilyActive(clinicId, familyId, now)
}

/** One entry per signed-in device: the most recently used live token of each family. */
export async function listLiveSessions(
  clinicId: string,
  userId: string,
  now: Date = new Date(),
): Promise<AuthSession[]> {
  const lastUsed = (session: AuthSession) => session.lastUsedAt?.getTime() ?? 0
  const newestByFamily = new Map<string, AuthSession>()

  for (const token of await sessionRepository.listLive(clinicId, userId, now)) {
    const existing = newestByFamily.get(token.familyId)
    if (!existing || lastUsed(token) > lastUsed(existing)) newestByFamily.set(token.familyId, token)
  }
  return [...newestByFamily.values()].sort((a, b) => lastUsed(b) - lastUsed(a))
}
