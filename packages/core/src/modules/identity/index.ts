export { verifyCredentials, type CredentialAttempt } from './application/verify-credentials'
export {
  startSession,
  rotateSession,
  endSessionFamily,
  endSessionByToken,
  endAllSessions,
  isSessionActive,
  listLiveSessions,
  type DeviceInfo,
  type IssuedRefreshToken,
} from './application/sessions'
export { changePassword, requestPasswordReset, resetPassword } from './application/passwords'
export { issueInvitation, previewInvitation, redeemInvitation } from './application/invitations'
export { findUser, updateProfile } from './application/users'
export { assertPasswordAllowed } from './application/password-rules'
export { pingRateLimitStore } from './application/dependencies'

export { AUTH_POLICY, type RateLimitRule } from './domain/auth-policy'
export {
  LOCKOUT_POLICY,
  lockDurationSeconds,
  lockedUntilAfter,
  failuresAreForgiven,
  isLocked,
} from './domain/lockout'
export { assessPassword, PASSWORD_ISSUES, type PasswordIssue } from './domain/password-policy'
export {
  signAccessToken,
  verifyAccessToken,
  generateOpaqueToken,
  hashOpaqueToken,
  AccessTokenClaimsSchema,
  type AccessTokenClaims,
  type TokenVerification,
} from './domain/tokens'
export {
  InvalidCredentialsError,
  TooManyAttemptsError,
  AccountDisabledError,
  TokenExpiredError,
  InvalidLinkError,
  PasswordPolicyError,
  CurrentPasswordIncorrectError,
} from './domain/errors'
export { displayNameOf, type AuthUser, type AuthSession } from './domain/types'
// NOT exported: repositories, the hasher, the rate limiter or the mailer.
