import { env } from '@clinic/config'
import type { SessionUser } from '@clinic/contracts'
import { UnauthenticatedError } from '../../../errors'
import { encodePermissions, landingPath, type Actor, type ResolvedAccess } from '../../access'
import type { ClinicSessionInfo } from '../../clinic'
import { AUTH_POLICY, displayNameOf, signAccessToken, type AuthUser } from '../../identity'
import type { IssuedAccessToken } from './types'

/** A saved portal preference only counts while the user can still enter that portal. */
export function effectivePreferredPortal(user: AuthUser, access: ResolvedAccess) {
  return user.preferredPortal && access.portals.includes(user.preferredPortal)
    ? user.preferredPortal
    : null
}

export function buildSessionUser(
  user: AuthUser,
  access: ResolvedAccess,
  clinic: ClinicSessionInfo,
): SessionUser {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    displayName: displayNameOf(user),
    phone: user.phone,
    status: user.status,
    roles: access.roles.map(({ key, name }) => ({ key, name })),
    portals: access.portals,
    preferredPortal: effectivePreferredPortal(user, access),
    landingPath: landingPath(access.portals, user.preferredPortal),
    clinic: { id: clinic.id, name: clinic.name, timezone: clinic.timezone, locale: clinic.locale },
  }
}

export function buildActor(user: AuthUser, access: ResolvedAccess, sessionId: string): Actor {
  return {
    kind: 'USER',
    userId: user.id,
    clinicId: user.clinicId,
    displayName: displayNameOf(user),
    roleKeys: access.roles.map((role) => role.key),
    permissions: access.permissions,
    portals: access.portals,
    preferredPortal: effectivePreferredPortal(user, access),
    sessionId,
  }
}

export function issueAccessToken(
  user: AuthUser,
  access: ResolvedAccess,
  clinic: ClinicSessionInfo,
  sessionId: string,
  now: Date = new Date(),
): Promise<IssuedAccessToken> {
  return signAccessToken(
    {
      sub: user.id,
      cid: user.clinicId,
      sid: sessionId,
      tv: user.tokenVersion,
      pv: clinic.permissionVersion,
      name: displayNameOf(user),
      rls: access.roles.map((role) => role.key),
      prm: encodePermissions(access.permissions),
      prt: access.portals,
      pp: effectivePreferredPortal(user, access),
    },
    env().AUTH_SECRET,
    AUTH_POLICY.accessTokenTtlSeconds,
    now,
  )
}

/** Self-service actions need a real signed-in session, not a system actor. */
export function requireSession(actor: Actor): string {
  if (actor.kind !== 'USER' || !actor.sessionId) throw new UnauthenticatedError()
  return actor.sessionId
}
