/**
 * The session module composes authentication (identity) with authorisation (access)
 * into a signed-in session. It sits above both, which is why login lives here rather
 * than in identity: identity is the foundation and may not depend on permissions.
 */
export {
  login,
  refresh,
  forgotPassword,
  resetForgottenPassword,
  previewActivation,
  acceptInvitation,
} from './application/sign-in'
export { authenticateAccessToken, type Authentication } from './application/authenticate'
export {
  getMe,
  updateMe,
  getMyPermissions,
  getMyNavigation,
  changeMyPassword,
  listMySessions,
  revokeMySession,
  logout,
  logoutEverywhere,
} from './application/self-service'
export { openSession } from './application/open-session'
export type { RequestMeta, IssuedSession, IssuedAccessToken } from './application/types'
