import { safeNextPath } from './safe-next'

const PORTAL_SEGMENTS: readonly string[] = ['admin', 'staff', 'doctor', 'patient']

/**
 * Where to go after signing in: the page the user was trying to reach, when it is safe
 * and inside a portal they can enter; otherwise their own landing page.
 *
 * Without the portal check, a stale ?next=/admin left behind by someone else's session
 * on a shared front-desk computer would walk a patient straight into a denied page.
 */
export function postLoginPath(
  next: string | null | undefined,
  user: { portals: readonly string[]; landingPath: string },
): string {
  const candidate = safeNextPath(next, '')
  if (!candidate || candidate === '/' || candidate.startsWith('/login')) return user.landingPath

  const segment = candidate.split(/[/?#]/)[1] ?? ''
  if (PORTAL_SEGMENTS.includes(segment) && !user.portals.includes(segment)) return user.landingPath

  return candidate
}
