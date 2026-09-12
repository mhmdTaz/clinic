import { env } from '@clinic/config'
import type { SessionUser } from '@clinic/contracts'
import { UnauthenticatedError } from '../../../errors'
import { encodePermissions, landingPath, type Actor, type ResolvedAccess } from '../../access'
import type { ClinicSessionInfo } from '../../clinic'
import { findDoctorIdForUser } from '../../doctors'
import { AUTH_POLICY, displayNameOf, signAccessToken, type AuthUser } from '../../identity'
import { findPatientIdForUser } from '../../patients'
import type { IssuedAccessToken } from './types'

/** A saved portal preference only counts while the user can still enter that portal. */
export function effectivePreferredPortal(user: AuthUser, access: ResolvedAccess) {
  return user.preferredPortal && access.portals.includes(user.preferredPortal)
    ? user.preferredPortal
    : null
}

/**
 * @param profiles the doctor and patient records this account is (ADR-0004).
 *
 * Carried in the response rather than left to the server-side actor, because a mobile client has
 * no actor: a patient's app that cannot name its own record cannot open a single screen. The web
 * ignores them and keeps reading the actor, so there is one source of truth and one extra field.
 */
export function buildSessionUser(
  user: AuthUser,
  access: ResolvedAccess,
  clinic: ClinicSessionInfo,
  profiles: { doctorId?: string; patientId?: string } = {},
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
    patientId: profiles.patientId ?? null,
    doctorId: profiles.doctorId ?? null,
    clinic: { id: clinic.id, name: clinic.name, timezone: clinic.timezone, locale: clinic.locale },
  }
}

export function buildActor(
  user: AuthUser,
  access: ResolvedAccess,
  sessionId: string,
  profiles: { doctorId?: string; patientId?: string } = {},
): Actor {
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
    ...(profiles.doctorId ? { doctorId: profiles.doctorId } : {}),
    ...(profiles.patientId ? { patientId: profiles.patientId } : {}),
  }
}

/**
 * The profile ids an ASSIGNED or OWN grant resolves against (ADR-0004). Looked up only for the
 * portals the user can actually enter, so staff and administrators pay nothing for them.
 */
export async function resolveProfileIds(
  user: AuthUser,
  access: ResolvedAccess,
): Promise<{ doctorId?: string; patientId?: string }> {
  const [doctorId, patientId] = await Promise.all([
    access.portals.includes('doctor') ? findDoctorIdForUser(user.clinicId, user.id) : null,
    access.portals.includes('patient') ? findPatientIdForUser(user.clinicId, user.id) : null,
  ])
  return { ...(doctorId ? { doctorId } : {}), ...(patientId ? { patientId } : {}) }
}

export async function issueAccessToken(
  user: AuthUser,
  access: ResolvedAccess,
  clinic: ClinicSessionInfo,
  sessionId: string,
  now: Date = new Date(),
): Promise<IssuedAccessToken> {
  const profiles = await resolveProfileIds(user, access)
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
      ...(profiles.doctorId ? { did: profiles.doctorId } : {}),
      ...(profiles.patientId ? { pid: profiles.patientId } : {}),
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
