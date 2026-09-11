import { PORTAL_KEYS, type PortalKey } from '@clinic/config'
import type { PermissionKey } from './permissions.catalog'
import type { PermissionMap } from './scopes'

export interface PortalDefinition {
  key: PortalKey
  permission: PermissionKey
  homePath: string
  labelKey: string
  icon: string
}

export const PORTALS: Readonly<Record<PortalKey, PortalDefinition>> = {
  admin: {
    key: 'admin',
    permission: 'portal.admin:access',
    homePath: '/admin',
    labelKey: 'portals.admin',
    icon: 'shield',
  },
  staff: {
    key: 'staff',
    permission: 'portal.staff:access',
    homePath: '/staff',
    labelKey: 'portals.staff',
    icon: 'clipboard-list',
  },
  doctor: {
    key: 'doctor',
    permission: 'portal.doctor:access',
    homePath: '/doctor',
    labelKey: 'portals.doctor',
    icon: 'stethoscope',
  },
  patient: {
    key: 'patient',
    permission: 'portal.patient:access',
    homePath: '/patient',
    labelKey: 'portals.patient',
    icon: 'heart-pulse',
  },
}

/** Where a signed-in user with no portal at all is sent, instead of a redirect loop. */
export const NO_PORTAL_PATH = '/no-access'

export function isPortalKey(value: unknown): value is PortalKey {
  return typeof value === 'string' && (PORTAL_KEYS as readonly string[]).includes(value)
}

export interface RolePortalWeight {
  priority: number
  permissionKeys: readonly string[]
}

/**
 * The portals an actor may enter, most relevant first (section 10.1).
 *
 * Each portal is weighted by the highest priority among the roles that grant it, so a
 * clinic owner holding both Admin (40) and Doctor (20) lands on admin. The fixed portal
 * order breaks ties, which keeps the result deterministic for custom roles that share
 * a priority.
 */
export function orderPortals(
  permissions: PermissionMap,
  roles: readonly RolePortalWeight[],
): PortalKey[] {
  const weight = (portal: PortalKey): number => {
    const permission = PORTALS[portal].permission
    let best = Number.NEGATIVE_INFINITY
    for (const role of roles) {
      if (role.permissionKeys.includes(permission) && role.priority > best) best = role.priority
    }
    return best
  }

  return PORTAL_KEYS.filter((key) => permissions.has(PORTALS[key].permission)).sort((a, b) => {
    const difference = weight(b) - weight(a)
    return Number.isNaN(difference) || difference === 0
      ? PORTAL_KEYS.indexOf(a) - PORTAL_KEYS.indexOf(b)
      : difference
  })
}

/** The user's saved choice wins, provided they can still enter that portal. */
export function landingPortal(
  portals: readonly PortalKey[],
  preferred: PortalKey | null | undefined,
): PortalKey | null {
  if (preferred && portals.includes(preferred)) return preferred
  return portals[0] ?? null
}

export function landingPath(
  portals: readonly PortalKey[],
  preferred: PortalKey | null | undefined,
): string {
  const portal = landingPortal(portals, preferred)
  return portal ? PORTALS[portal].homePath : NO_PORTAL_PATH
}

export function portalFromPath(pathname: string): PortalKey | null {
  const segment = pathname.split('/')[1]
  return isPortalKey(segment) ? segment : null
}
