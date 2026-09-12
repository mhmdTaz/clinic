import { z } from 'zod'
import { successResponse } from './envelope'

/**
 * Authentication contracts (sections 9 and 10). Shared by the route handlers, the web
 * forms and — later — the mobile app, so a field renamed here fails to compile
 * everywhere it is used rather than failing at runtime on someone's phone.
 */
export const PortalKey = z.enum(['admin', 'staff', 'doctor', 'patient'])
export type PortalKey = z.infer<typeof PortalKey>

export const PASSWORD_MIN_LENGTH = 12
export const PASSWORD_MAX_LENGTH = 128

/** Counted in code points, matching the server's password policy exactly. */
const codePoints = (value: string) => [...value].length

export const EmailAddress = z.string().trim().toLowerCase().email().max(254)

export const NewPassword = z
  .string()
  .refine((value) => codePoints(value) >= PASSWORD_MIN_LENGTH, { message: 'TOO_SHORT' })
  .refine((value) => codePoints(value) <= PASSWORD_MAX_LENGTH, { message: 'TOO_LONG' })

/**
 * Existing passwords are only length-capped, never re-checked against today's policy:
 * a user must always be able to sign in with the password they were allowed to set.
 * The cap stops a megabyte "password" from tying up a hashing thread.
 */
const ExistingPassword = z.string().min(1).max(1024)

export const OpaqueToken = z.string().min(20).max(200)

/** Browsers get httpOnly cookies. The mobile app asks for tokens in the response body. */
export const TokenDelivery = z.enum(['cookie', 'body']).default('cookie')

export const LoginRequest = z.object({
  email: EmailAddress,
  password: ExistingPassword,
  tokenDelivery: TokenDelivery,
  deviceName: z.string().trim().max(80).optional(),
})
export type LoginRequest = z.infer<typeof LoginRequest>

export const SessionTokens = z.object({
  accessToken: z.string(),
  accessTokenExpiresAt: z.string().datetime(),
  refreshToken: z.string(),
  refreshTokenExpiresAt: z.string().datetime(),
})
export type SessionTokens = z.infer<typeof SessionTokens>

export const SessionUser = z.object({
  id: z.string(),
  email: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  displayName: z.string(),
  phone: z.string().nullable(),
  status: z.enum(['INVITED', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED']),
  roles: z.array(z.object({ key: z.string(), name: z.string() })),
  portals: z.array(PortalKey),
  preferredPortal: PortalKey.nullable(),
  landingPath: z.string(),
  /**
   * The profile records this account *is*, when it is one (ADR-0004).
   *
   * The web reads these off the server-side actor and never needed them in a payload. A device
   * has no actor: without them a patient's app cannot find its own record, and every screen in
   * the patient portal starts from that record. Nullable because staff and administrators are
   * neither.
   */
  patientId: z.string().nullable(),
  doctorId: z.string().nullable(),
  clinic: z.object({
    id: z.string(),
    name: z.string(),
    timezone: z.string(),
    locale: z.string(),
  }),
})
export type SessionUser = z.infer<typeof SessionUser>

export const SessionResult = z.object({
  user: SessionUser,
  /** Present only when tokenDelivery was "body". */
  tokens: SessionTokens.optional(),
})
export type SessionResult = z.infer<typeof SessionResult>
export const SessionResponse = successResponse(SessionResult)

export const RefreshRequest = z.object({
  /** Omitted by browsers, which send the refresh cookie instead. */
  refreshToken: OpaqueToken.optional(),
  tokenDelivery: TokenDelivery,
})
export type RefreshRequest = z.infer<typeof RefreshRequest>

export const LogoutRequest = z.object({
  /** The mobile app sends its refresh token; browsers rely on the cookie. */
  refreshToken: OpaqueToken.optional(),
})
export type LogoutRequest = z.infer<typeof LogoutRequest>

export const ForgotPasswordRequest = z.object({ email: EmailAddress })
export type ForgotPasswordRequest = z.infer<typeof ForgotPasswordRequest>

export const ResetPasswordRequest = z.object({ token: OpaqueToken, password: NewPassword })
export type ResetPasswordRequest = z.infer<typeof ResetPasswordRequest>

export const InvitationPreviewRequest = z.object({ token: OpaqueToken })
export const InvitationPreview = z.object({
  email: z.string(),
  firstName: z.string(),
  clinicName: z.string(),
  expiresAt: z.string().datetime(),
})
export type InvitationPreview = z.infer<typeof InvitationPreview>

export const AcceptInvitationRequest = z.object({
  token: OpaqueToken,
  password: NewPassword,
  tokenDelivery: TokenDelivery,
})
export type AcceptInvitationRequest = z.infer<typeof AcceptInvitationRequest>

export const ChangePasswordRequest = z.object({
  currentPassword: ExistingPassword,
  newPassword: NewPassword,
})
export type ChangePasswordRequest = z.infer<typeof ChangePasswordRequest>

/** Returned by endpoints that must not reveal whether anything matched. */
export const AcceptedResponse = successResponse(z.object({ accepted: z.literal(true) }))
