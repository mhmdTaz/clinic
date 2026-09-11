import { env } from '@clinic/config'
import { UnauthenticatedError } from '../../../errors'
import { decodePermissions, resolveAccess, type Actor } from '../../access'
import { getClinicSessionInfo } from '../../clinic'
import {
  TokenExpiredError,
  displayNameOf,
  findUser,
  isSessionActive,
  verifyAccessToken,
} from '../../identity'
import { buildActor, issueAccessToken } from './session-user'
import type { IssuedAccessToken } from './types'

export interface Authentication {
  actor: Actor
  /** Set when the token was stale and has been replaced; the caller should store it. */
  reissued: IssuedAccessToken | null
}

/**
 * Turns a bearer or cookie access token into the actor a request runs as.
 *
 * The signature alone is not trusted for long. Every request also confirms, against
 * the database, that the user is still active, that the session was not signed out,
 * and that the token version has not moved. A suspended user loses access on their
 * next request, not fifteen minutes later when the token would have expired.
 */
export async function authenticateAccessToken(
  token: string,
  now: Date = new Date(),
): Promise<Authentication> {
  const verification = await verifyAccessToken(token, env().AUTH_SECRET, now)
  if (!verification.ok) {
    throw verification.reason === 'EXPIRED' ? new TokenExpiredError() : new UnauthenticatedError()
  }

  const { claims } = verification
  // A token minted by a different installation is not this clinic's business.
  if (claims.cid !== env().CLINIC_ID) throw new UnauthenticatedError()

  const [user, clinic, sessionActive] = await Promise.all([
    findUser(claims.cid, claims.sub),
    getClinicSessionInfo(claims.cid),
    isSessionActive(claims.cid, claims.sid, now),
  ])

  if (!user || user.status !== 'ACTIVE' || !sessionActive || user.tokenVersion !== claims.tv) {
    throw new UnauthenticatedError('Your session has ended. Please sign in again.')
  }

  // Grants changed since this token was issued (section 7.7). Authorise THIS request
  // against the current grants and hand back a replacement token.
  if (claims.pv !== clinic.permissionVersion) {
    const access = await resolveAccess(user.clinicId, user.roleIds)
    return {
      actor: buildActor(user, access, claims.sid),
      reissued: await issueAccessToken(user, access, clinic, claims.sid, now),
    }
  }

  return {
    actor: {
      kind: 'USER',
      userId: user.id,
      clinicId: user.clinicId,
      displayName: displayNameOf(user),
      roleKeys: claims.rls,
      permissions: decodePermissions(claims.prm),
      portals: claims.prt,
      preferredPortal: claims.pp,
      sessionId: claims.sid,
    },
    reissued: null,
  }
}
