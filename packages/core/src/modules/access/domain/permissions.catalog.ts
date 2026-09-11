/**
 * The permission catalogue (ARCHITECTURE.md section 7.2).
 *
 * Permission KEYS live here, in code, and arrive by deploy. GRANTS — which role
 * holds which permission at which scope — are pure data that an admin edits at
 * runtime. The admin permission matrix renders straight from this object, so a new
 * permission appears in the editor the moment it is added here.
 *
 *  - scopable   the grant carries an OWN / ASSIGNED / CLINIC / GLOBAL scope (7.3)
 *  - phi        reads of this subject are audited (11.3)
 *  - dangerous  the matrix toggle asks for confirmation
 */
export const PERMISSION_GROUPS = [
  'portals',
  'clinic',
  'users',
  'roles',
  'audit',
  'patients',
  'doctors',
  'scheduling',
  'clinical',
  'files',
  'billing',
  'inventory',
  'support',
  'reports',
] as const

export type PermissionGroup = (typeof PERMISSION_GROUPS)[number]

export interface PermissionDefinition {
  group: PermissionGroup
  scopable?: boolean
  phi?: boolean
  dangerous?: boolean
}

const define = (
  group: PermissionGroup,
  flags: Omit<PermissionDefinition, 'group'> = {},
): PermissionDefinition => ({ group, ...flags })

export const PERMISSIONS = {
  'portal.admin:access': define('portals'),
  'portal.staff:access': define('portals'),
  'portal.doctor:access': define('portals'),
  'portal.patient:access': define('portals'),

  'clinic:read': define('clinic'),
  'clinic:update': define('clinic'),
  'branch:manage': define('clinic'),
  'service:read': define('clinic'),
  'service:manage': define('clinic'),

  'user:read': define('users', { scopable: true }),
  'user:invite': define('users'),
  'user:update': define('users', { scopable: true }),
  'user:suspend': define('users', { dangerous: true }),
  'user:reset_password': define('users', { dangerous: true }),
  'user:impersonate': define('users', { dangerous: true }),

  'role:read': define('roles'),
  'role:create': define('roles'),
  'role:update': define('roles', { dangerous: true }),
  'role:delete': define('roles', { dangerous: true }),
  'role:assign': define('roles', { dangerous: true }),

  'audit:read': define('audit'),
  'audit:export': define('audit', { dangerous: true }),

  'patient:read': define('patients', { scopable: true, phi: true }),
  'patient:create': define('patients'),
  'patient:update': define('patients', { scopable: true }),
  'patient:delete': define('patients', { dangerous: true }),

  'doctor:read': define('doctors'),
  'doctor:create': define('doctors'),
  'doctor:update': define('doctors', { scopable: true }),
  'doctor:delete': define('doctors', { dangerous: true }),
  'specialty:manage': define('doctors'),

  'availability:read': define('scheduling', { scopable: true }),
  'availability:manage': define('scheduling', { scopable: true }),
  'appointment:read': define('scheduling', { scopable: true }),
  'appointment:create': define('scheduling', { scopable: true }),
  'appointment:update': define('scheduling', { scopable: true }),
  'appointment:cancel': define('scheduling', { scopable: true }),
  'appointment:check_in': define('scheduling'),

  'encounter:read': define('clinical', { scopable: true, phi: true }),
  'encounter:write': define('clinical', { scopable: true, phi: true }),
  'encounter:sign': define('clinical', { scopable: true }),
  'prescription:read': define('clinical', { scopable: true, phi: true }),
  'prescription:issue': define('clinical', { scopable: true }),

  'file:read': define('files', { scopable: true, phi: true }),
  'file:upload': define('files', { scopable: true }),
  'file:delete': define('files', { scopable: true, dangerous: true }),

  'invoice:read': define('billing', { scopable: true }),
  'invoice:create': define('billing'),
  'invoice:issue': define('billing'),
  'invoice:void': define('billing', { dangerous: true }),
  'payment:read': define('billing', { scopable: true }),
  'payment:record': define('billing'),
  'payment:refund': define('billing', { dangerous: true }),

  'inventory:read': define('inventory'),
  'inventory:manage': define('inventory'),
  'inventory:adjust': define('inventory'),

  'ticket:read': define('support', { scopable: true }),
  'ticket:create': define('support', { scopable: true }),
  'ticket:reply': define('support', { scopable: true }),
  'ticket:assign': define('support'),
  'ticket:manage': define('support'),

  'analytics:read': define('reports'),
} as const satisfies Record<string, PermissionDefinition>

export type PermissionKey = keyof typeof PERMISSIONS

export const PERMISSION_KEYS = Object.keys(PERMISSIONS) as PermissionKey[]

export function isPermissionKey(value: string): value is PermissionKey {
  return Object.prototype.hasOwnProperty.call(PERMISSIONS, value)
}

/** "patient:read" -> "patient", "portal.admin:access" -> "portal.admin". */
export function subjectOf(permission: PermissionKey): string {
  return permission.slice(0, permission.indexOf(':'))
}

/** Message key for the admin matrix label, e.g. "permissions.patient.read". */
export function permissionLabelKey(permission: PermissionKey): string {
  return `permissions.${permission.replace(':', '.')}`
}
