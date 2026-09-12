import { env, resolveFeatureFlags, type FeatureFlags, type PortalKey } from '@clinic/config'
import type {
  MeNavigation,
  MePermissions,
  SessionSummary,
  SessionUser,
  UpdateMeRequest,
} from '@clinic/contracts'
import {
  BusinessRuleError,
  ForbiddenError,
  NotFoundError,
  UnauthenticatedError,
} from '../../../errors'
import { recordAudit } from '../../audit'
import {
  assertCan,
  landingPortal,
  resolveAccess,
  toGrantList,
  visibleNavigation,
  type Actor,
} from '../../access'
import { getClinicSessionInfo } from '../../clinic'
import {
  changePassword,
  endAllSessions,
  endSessionByToken,
  endSessionFamily,
  findUser,
  listLiveSessions,
  updateProfile,
} from '../../identity'
import {
  buildSessionUser,
  issueAccessToken,
  requireSession,
  resolveProfileIds,
} from './session-user'
import type { IssuedAccessToken } from './types'

async function freshSessionParts(actor: Actor) {
  const user = await findUser(actor.clinicId, actor.userId)
  if (!user || user.status !== 'ACTIVE') throw new UnauthenticatedError()
  const [access, clinic] = await Promise.all([
    resolveAccess(user.clinicId, user.roleIds),
    getClinicSessionInfo(user.clinicId),
  ])
  return { user, access, clinic }
}

export async function getMe(actor: Actor): Promise<SessionUser> {
  const { user, access, clinic } = await freshSessionParts(actor)
  return buildSessionUser(user, access, clinic, await resolveProfileIds(user, access))
}

/**
 * The portal preference is a UI setting anyone may change. Name and phone are personal
 * data, so they also need user:update on the actor's own account.
 */
export async function updateMe(
  actor: Actor,
  patch: UpdateMeRequest,
  now: Date = new Date(),
): Promise<{ user: SessionUser; accessToken: IssuedAccessToken }> {
  const sessionId = requireSession(actor)

  if (patch.preferredPortal && !actor.portals.includes(patch.preferredPortal)) {
    throw new BusinessRuleError('PORTAL_NOT_AVAILABLE', 'You do not have access to that portal.')
  }
  const editsProfile =
    patch.firstName !== undefined || patch.lastName !== undefined || patch.phone !== undefined
  if (editsProfile) {
    await assertCan(actor, 'user:update', {
      clinicId: actor.clinicId,
      type: 'User',
      id: actor.userId,
    })
  }

  const updated = await updateProfile(actor.clinicId, actor.userId, patch)
  if (!updated) throw new UnauthenticatedError()

  const { user, access, clinic } = await freshSessionParts(actor)
  return {
    user: buildSessionUser(user, access, clinic, await resolveProfileIds(user, access)),
    // The token carries the display name and the preferred portal, so it is reissued.
    accessToken: await issueAccessToken(user, access, clinic, sessionId, now),
  }
}

export async function getMyPermissions(actor: Actor): Promise<MePermissions> {
  const clinic = await getClinicSessionInfo(actor.clinicId)
  return {
    permissions: toGrantList(actor.permissions),
    permissionVersion: clinic.permissionVersion,
  }
}

export async function getMyNavigation(actor: Actor, requested?: PortalKey): Promise<MeNavigation> {
  const portal =
    requested && actor.portals.includes(requested)
      ? requested
      : landingPortal(actor.portals, actor.preferredPortal)
  if (!portal) throw new ForbiddenError('portal access')

  const clinic = await getClinicSessionInfo(actor.clinicId)
  const flags = resolveFeatureFlags(clinic.featureFlags as Partial<FeatureFlags>)

  return {
    portal,
    sections: visibleNavigation(portal, actor.permissions, flags).map((section) => ({
      id: section.id,
      labelKey: section.labelKey,
      items: section.items.map(({ id, labelKey, href, icon }) => ({ id, labelKey, href, icon })),
    })),
  }
}

/**
 * Always allowed to a signed-in user: changing your own password is security hygiene,
 * and no role configuration should be able to take it away.
 */
export async function changeMyPassword(
  actor: Actor,
  input: { currentPassword: string; newPassword: string },
  now: Date = new Date(),
): Promise<IssuedAccessToken> {
  const sessionId = requireSession(actor)
  await changePassword(
    {
      clinicId: actor.clinicId,
      userId: actor.userId,
      currentPassword: input.currentPassword,
      newPassword: input.newPassword,
    },
    now,
  )
  // Every other device is signed out; this one continues with a token on the new version.
  await endAllSessions(
    actor.clinicId,
    actor.userId,
    'password_changed',
    { exceptFamilyId: sessionId },
    now,
  )

  const { user, access, clinic } = await freshSessionParts(actor)
  return issueAccessToken(user, access, clinic, sessionId, now)
}

export async function listMySessions(
  actor: Actor,
  now: Date = new Date(),
): Promise<SessionSummary[]> {
  const sessions = await listLiveSessions(actor.clinicId, actor.userId, now)
  return sessions.map((session) => ({
    id: session.familyId,
    deviceName: session.deviceName,
    userAgent: session.userAgent,
    ipAddress: session.ipAddress,
    startedAt: session.startedAt.toISOString(),
    lastUsedAt: session.lastUsedAt?.toISOString() ?? null,
    expiresAt: session.expiresAt.toISOString(),
    current: session.familyId === actor.sessionId,
  }))
}

export async function revokeMySession(
  actor: Actor,
  sessionId: string,
  now: Date = new Date(),
): Promise<void> {
  const sessions = await listLiveSessions(actor.clinicId, actor.userId, now)
  // Only your own sessions: an unknown id and someone else's id look identical.
  if (!sessions.some((session) => session.familyId === sessionId))
    throw new NotFoundError('Session')

  await endSessionFamily(actor.clinicId, sessionId, 'revoked_by_user', now)
  await recordAudit({
    action: 'auth.session_revoked',
    category: 'AUTH',
    severity: 'NOTICE',
    clinicId: actor.clinicId,
    entity: { type: 'User', id: actor.userId },
    metadata: { sessionId, current: sessionId === actor.sessionId },
  })
}

/** Works with either an access token's actor, a refresh token, or both. */
export async function logout(
  input: { actor?: Actor | null; refreshToken?: string | null },
  now: Date = new Date(),
): Promise<void> {
  const clinicId = env().CLINIC_ID
  let sessionId = input.actor?.sessionId ?? null
  let userId = input.actor?.kind === 'USER' ? input.actor.userId : null

  if (input.refreshToken) {
    const ended = await endSessionByToken(clinicId, input.refreshToken, 'logout', now)
    sessionId ??= ended?.familyId ?? null
    userId ??= ended?.userId ?? null
  }
  if (sessionId) await endSessionFamily(clinicId, sessionId, 'logout', now)

  if (userId) {
    await recordAudit({
      action: 'auth.logout',
      category: 'AUTH',
      clinicId,
      entity: { type: 'User', id: userId },
      metadata: { sessionId },
    })
  }
}

export async function logoutEverywhere(actor: Actor, now: Date = new Date()): Promise<void> {
  requireSession(actor)
  await endAllSessions(actor.clinicId, actor.userId, 'logout_everywhere', {}, now)
  await recordAudit({
    action: 'auth.logout_everywhere',
    category: 'AUTH',
    severity: 'NOTICE',
    clinicId: actor.clinicId,
    entity: { type: 'User', id: actor.userId },
  })
}
