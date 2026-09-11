import { PERMISSION_KEYS, type PermissionKey } from './permissions.catalog'
import type { Scope } from './scopes'

export type SystemRoleKey = 'admin' | 'staff' | 'doctor' | 'patient'

export interface SystemRoleDefinition {
  key: SystemRoleKey
  name: string
  description: string
  priority: number
  isDefault: boolean
  grants: ReadonlyArray<{ key: PermissionKey; scope: Scope }>
}

const at =
  (scope: Scope) =>
  (...keys: PermissionKey[]) =>
    keys.map((key) => ({ key, scope }))

const clinic = at('CLINIC')
const assigned = at('ASSIGNED')
const own = at('OWN')

/**
 * The doctor and patient portals are "my patients" / "my appointments" experiences
 * bound to a profile. Granting them to Admin would hand every administrator two empty
 * portals; a clinic owner who also practises holds the Doctor role as well.
 */
const PROFILE_BOUND_PORTALS: readonly PermissionKey[] = [
  'portal.doctor:access',
  'portal.patient:access',
]

/**
 * The four seeded roles (section 7.4). These are starting points, not constants:
 * the grants are data an admin can edit at runtime. `isSystem` only protects the
 * roles from deletion.
 */
export const SYSTEM_ROLES: readonly SystemRoleDefinition[] = [
  {
    key: 'admin',
    name: 'Administrator',
    description: 'Full control of the clinic, its users, roles and audit log.',
    priority: 40,
    isDefault: false,
    grants: clinic(...PERMISSION_KEYS.filter((key) => !PROFILE_BOUND_PORTALS.includes(key))),
  },
  {
    key: 'staff',
    name: 'Staff',
    description: 'Front desk: patients, doctors, appointments, billing, inventory and support.',
    priority: 30,
    isDefault: false,
    grants: [
      ...clinic(
        'portal.staff:access',
        'clinic:read',
        'service:read',
        'patient:read',
        'patient:create',
        'patient:update',
        'patient:delete',
        'doctor:read',
        'doctor:create',
        'doctor:update',
        'doctor:delete',
        'specialty:manage',
        'availability:read',
        'availability:manage',
        'appointment:read',
        'appointment:create',
        'appointment:update',
        'appointment:cancel',
        'appointment:check_in',
        // Staff may read clinical records but never write them (section 7.4).
        'encounter:read',
        'prescription:read',
        'file:read',
        'file:upload',
        'invoice:read',
        'invoice:create',
        'invoice:issue',
        'invoice:void',
        'payment:read',
        'payment:record',
        'payment:refund',
        'inventory:read',
        'inventory:manage',
        'inventory:adjust',
        'ticket:read',
        'ticket:create',
        'ticket:reply',
        'ticket:assign',
        'ticket:manage',
        'analytics:read',
      ),
      ...own('user:read', 'user:update'),
    ],
  },
  {
    key: 'doctor',
    name: 'Doctor',
    description: 'Patients under their care, their encounters, prescriptions and schedule.',
    priority: 20,
    isDefault: false,
    grants: [
      ...clinic('portal.doctor:access', 'clinic:read', 'service:read', 'doctor:read'),
      ...assigned(
        'patient:read',
        'appointment:read',
        'appointment:create',
        'encounter:read',
        'encounter:write',
        'encounter:sign',
        'prescription:read',
        'prescription:issue',
        'file:read',
        'file:upload',
      ),
      ...own(
        'doctor:update',
        'availability:read',
        'availability:manage',
        'ticket:read',
        'ticket:create',
        'ticket:reply',
        'user:read',
        'user:update',
      ),
    ],
  },
  {
    key: 'patient',
    name: 'Patient',
    description: 'Their own record, appointments, documents, invoices and support tickets.',
    priority: 10,
    isDefault: true,
    grants: [
      // Doctor and availability reads are clinic-wide so a patient can choose a doctor
      // and see open slots when booking (P5).
      ...clinic(
        'portal.patient:access',
        'clinic:read',
        'service:read',
        'doctor:read',
        'availability:read',
      ),
      ...own(
        'patient:read',
        'patient:update',
        'appointment:read',
        'appointment:create',
        'appointment:cancel',
        'encounter:read',
        'prescription:read',
        'file:read',
        'invoice:read',
        'payment:read',
        'ticket:read',
        'ticket:create',
        'ticket:reply',
        'user:read',
        'user:update',
      ),
    ],
  },
]
