/** Portals, in the order they are considered when resolving a landing page (section 10.1). */
export const PORTAL_KEYS = ['admin', 'staff', 'doctor', 'patient'] as const
export type PortalKey = (typeof PORTAL_KEYS)[number]

/** Scope of a permission grant — which rows a permission reaches (section 7.3). */
export const PERMISSION_SCOPES = ['OWN', 'ASSIGNED', 'CLINIC', 'GLOBAL'] as const
export type PermissionScope = (typeof PERMISSION_SCOPES)[number]

export const USER_STATUSES = ['INVITED', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED'] as const
export type UserStatus = (typeof USER_STATUSES)[number]

/** Smallest bookable increment, and the slot-reservation grid size (section 8.7). */
export const SLOT_GRID_MINUTES = 5

/** Pagination ceiling enforced by every list endpoint (section 9.2). */
export const MAX_PAGE_SIZE = 100
export const DEFAULT_PAGE_SIZE = 25

/**
 * Build/runtime version, surfaced by the health endpoint. Lives here because
 * @clinic/config is the only package permitted to read process.env (section 13.1).
 */
export const APP_VERSION: string = process.env.npm_package_version ?? '0.0.0'
