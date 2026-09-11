import { env } from '@clinic/config'
import type { InvitationPreview } from '@clinic/contracts'
import { resolveAccess } from '../../access'
import { getClinicSessionInfo } from '../../clinic'
import {
  previewInvitation,
  redeemInvitation,
  requestPasswordReset,
  resetPassword,
  rotateSession,
  verifyCredentials,
} from '../../identity'
import { openSession } from './open-session'
import { buildSessionUser, issueAccessToken } from './session-user'
import { deviceFrom, type IssuedSession, type RequestMeta } from './types'

/** Every function here serves the installation's single clinic (ADR-0005). */
const installationClinicId = () => env().CLINIC_ID

export async function login(
  input: { email: string; password: string; meta: RequestMeta },
  now: Date = new Date(),
): Promise<IssuedSession> {
  const user = await verifyCredentials(
    {
      clinicId: installationClinicId(),
      email: input.email,
      password: input.password,
      ipAddress: input.meta.ipAddress,
    },
    now,
  )
  return openSession(user, input.meta, 'password', now)
}

/**
 * Rotates the refresh token and re-resolves permissions from scratch. Not audited: a
 * refresh every fifteen minutes per user would bury everything else in the log.
 */
export async function refresh(
  input: { refreshToken: string; meta: RequestMeta },
  now: Date = new Date(),
): Promise<IssuedSession> {
  const rotated = await rotateSession(
    {
      clinicId: installationClinicId(),
      presentedToken: input.refreshToken,
      device: deviceFrom(input.meta),
    },
    now,
  )
  const { user } = rotated
  const [access, clinic] = await Promise.all([
    resolveAccess(user.clinicId, user.roleIds),
    getClinicSessionInfo(user.clinicId),
  ])
  const accessToken = await issueAccessToken(user, access, clinic, rotated.refresh.familyId, now)

  return {
    user: buildSessionUser(user, access, clinic),
    sessionId: rotated.refresh.familyId,
    accessToken: accessToken.token,
    accessTokenExpiresAt: accessToken.expiresAt,
    refreshToken: rotated.refresh.token,
    refreshTokenExpiresAt: rotated.refresh.expiresAt,
  }
}

export async function forgotPassword(
  input: { email: string; meta: RequestMeta },
  now: Date = new Date(),
): Promise<void> {
  const clinic = await getClinicSessionInfo(installationClinicId())
  await requestPasswordReset(
    {
      clinicId: clinic.id,
      email: input.email,
      ipAddress: input.meta.ipAddress,
      appUrl: env().APP_URL,
      clinicName: clinic.name,
    },
    now,
  )
}

/** Deliberately does not sign the user in: they prove the new password by using it. */
export async function resetForgottenPassword(
  input: { token: string; password: string; meta: RequestMeta },
  now: Date = new Date(),
): Promise<void> {
  await resetPassword(
    {
      clinicId: installationClinicId(),
      token: input.token,
      newPassword: input.password,
      ipAddress: input.meta.ipAddress,
    },
    now,
  )
}

export async function previewActivation(
  input: { token: string; meta: RequestMeta },
  now: Date = new Date(),
): Promise<InvitationPreview> {
  const clinic = await getClinicSessionInfo(installationClinicId())
  const preview = await previewInvitation(
    { clinicId: clinic.id, token: input.token, ipAddress: input.meta.ipAddress },
    now,
  )
  return {
    email: preview.email,
    firstName: preview.firstName,
    clinicName: clinic.name,
    expiresAt: preview.expiresAt.toISOString(),
  }
}

/**
 * Activation signs the user straight in: holding the emailed link has already proved
 * they own the address.
 */
export async function acceptInvitation(
  input: { token: string; password: string; meta: RequestMeta },
  now: Date = new Date(),
): Promise<IssuedSession> {
  const user = await redeemInvitation(
    {
      clinicId: installationClinicId(),
      token: input.token,
      password: input.password,
      ipAddress: input.meta.ipAddress,
    },
    now,
  )
  return openSession(user, input.meta, 'invitation', now)
}
