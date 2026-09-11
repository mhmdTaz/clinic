/** Portals, in the order they are considered when resolving a landing page (section 10.1). */
export const PORTAL_KEYS = ['admin', 'staff', 'doctor', 'patient'] as const
export type PortalKey = (typeof PORTAL_KEYS)[number]

/** Scope of a permission grant — which rows a permission reaches (section 7.3). */
export const PERMISSION_SCOPES = ['OWN', 'ASSIGNED', 'CLINIC', 'GLOBAL'] as const
export type PermissionScope = (typeof PERMISSION_SCOPES)[number]

export const USER_STATUSES = ['INVITED', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED'] as const
export type UserStatus = (typeof USER_STATUSES)[number]

/**
 * Audit taxonomy (section 8.13). Declared here because both the model in @clinic/db
 * and the recorder in @clinic/core need it, and neither may import the other's
 * internals.
 */
export const AUDIT_CATEGORIES = [
  'AUTH',
  'ACCESS_CONTROL',
  'CLINICAL',
  'FINANCIAL',
  'INVENTORY',
  'ADMIN',
  'FILE',
  'SUPPORT',
  'SYSTEM',
] as const
export type AuditCategory = (typeof AUDIT_CATEGORIES)[number]

export const AUDIT_SEVERITIES = ['INFO', 'NOTICE', 'WARNING', 'CRITICAL'] as const
export type AuditSeverity = (typeof AUDIT_SEVERITIES)[number]

export const AUDIT_OUTCOMES = ['SUCCESS', 'FAILURE', 'DENIED'] as const
export type AuditOutcome = (typeof AUDIT_OUTCOMES)[number]

export const ACTOR_TYPES = ['USER', 'SYSTEM', 'API_CLIENT', 'ANONYMOUS'] as const
export type ActorType = (typeof ACTOR_TYPES)[number]

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
