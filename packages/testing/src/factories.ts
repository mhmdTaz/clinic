import { newId } from '@clinic/db'
import type { Clinic, Branch } from '@clinic/core/clinic'
import type { PermissionScope, UserStatus } from '@clinic/config'

/**
 * Test factories. Every factory takes overrides, so a test states only the field it
 * actually cares about and the rest stays plausible — a test that spells out twelve
 * irrelevant fields hides which one matters.
 */
let counter = 0
const seq = () => ++counter

export function buildBranch(overrides: Partial<Branch> = {}): Branch {
  return { id: newId(), name: `Branch ${seq()}`, isActive: true, ...overrides }
}

export function buildClinic(overrides: Partial<Clinic> = {}): Clinic {
  return {
    id: newId(),
    name: `Clinic ${seq()}`,
    timezone: 'Asia/Beirut',
    currency: 'USD',
    locale: 'en',
    branches: [buildBranch()],
    ...overrides,
  }
}

export interface UserSeed {
  _id: string
  clinicId: string
  email: string
  firstName: string
  lastName: string
  status: UserStatus
  roles: Array<{ roleId: string; assignedAt: Date }>
  deletedAt: Date | null
}

export function buildUser(overrides: Partial<UserSeed> = {}): UserSeed {
  const n = seq()
  return {
    _id: newId(),
    clinicId: newId(),
    email: `user${n}@clinic.test`,
    firstName: `First${n}`,
    lastName: `Last${n}`,
    status: 'ACTIVE',
    roles: [],
    deletedAt: null,
    ...overrides,
  }
}

export interface RoleSeed {
  _id: string
  clinicId: string
  key: string
  name: string
  isSystem: boolean
  priority: number
  permissions: Array<{ key: string; scope: PermissionScope }>
}

export function buildRole(overrides: Partial<RoleSeed> = {}): RoleSeed {
  const n = seq()
  return {
    _id: newId(),
    clinicId: newId(),
    key: `role-${n}`,
    name: `Role ${n}`,
    isSystem: false,
    priority: 0,
    permissions: [],
    ...overrides,
  }
}

/** Grants, written the way the admin matrix UI produces them. */
export function grants(
  ...entries: Array<[string, PermissionScope] | string>
): Array<{ key: string; scope: PermissionScope }> {
  return entries.map((e) =>
    typeof e === 'string'
      ? { key: e, scope: 'CLINIC' as PermissionScope }
      : { key: e[0], scope: e[1] },
  )
}
