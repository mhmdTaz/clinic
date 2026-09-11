/**
 * The subset the middleware needs: verify a token and route to a portal — with no
 * database, no driver and nothing that would pull either in.
 *
 * It imports domain files directly, bypassing the module entry points on purpose:
 * those entry points also export application code that loads the database driver,
 * and the middleware must never carry that into its bundle.
 */
export {
  verifyAccessToken,
  type AccessTokenClaims,
  type TokenVerification,
} from './modules/identity/domain/tokens'
export { decodePermissions } from './modules/access/domain/scopes'
export {
  PORTALS,
  NO_PORTAL_PATH,
  isPortalKey,
  landingPath,
  portalFromPath,
} from './modules/access/domain/portals'
