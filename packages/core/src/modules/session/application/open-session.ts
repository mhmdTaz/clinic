import { recordAudit } from '../../audit'
import { resolveAccess } from '../../access'
import { getClinicSessionInfo } from '../../clinic'
import { displayNameOf, startSession, type AuthUser } from '../../identity'
import { buildSessionUser, issueAccessToken } from './session-user'
import { deviceFrom, type IssuedSession, type RequestMeta } from './types'

/**
 * Turns a verified user into a signed-in session: resolve permissions, start a
 * refresh-token family, sign an access token, and record the sign-in as the user.
 */
export async function openSession(
  user: AuthUser,
  meta: RequestMeta,
  via: 'password' | 'invitation',
  now: Date = new Date(),
): Promise<IssuedSession> {
  const [access, clinic] = await Promise.all([
    resolveAccess(user.clinicId, user.roleIds),
    getClinicSessionInfo(user.clinicId),
  ])

  const refresh = await startSession(
    { clinicId: user.clinicId, userId: user.id, device: deviceFrom(meta) },
    now,
  )
  const accessToken = await issueAccessToken(user, access, clinic, refresh.familyId, now)

  await recordAudit({
    action: 'auth.login',
    category: 'AUTH',
    clinicId: user.clinicId,
    actor: {
      id: user.id,
      type: 'USER',
      label: displayNameOf(user),
      roles: access.roles.map((role) => role.key),
    },
    entity: { type: 'User', id: user.id, label: user.email },
    metadata: { via, sessionId: refresh.familyId, portals: access.portals },
  })

  return {
    user: buildSessionUser(user, access, clinic),
    sessionId: refresh.familyId,
    accessToken: accessToken.token,
    accessTokenExpiresAt: accessToken.expiresAt,
    refreshToken: refresh.token,
    refreshTokenExpiresAt: refresh.expiresAt,
  }
}
