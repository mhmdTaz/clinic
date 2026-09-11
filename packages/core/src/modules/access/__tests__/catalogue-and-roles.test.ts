import { describe, expect, it } from 'vitest'
import {
  PERMISSIONS,
  PERMISSION_GROUPS,
  PERMISSION_KEYS,
  permissionLabelKey,
  subjectOf,
  type PermissionKey,
} from '../domain/permissions.catalog'
import { SYSTEM_ROLES, type SystemRoleKey } from '../domain/system-roles'
import { systemActor } from '../domain/system-actor'

const role = (key: SystemRoleKey) => {
  const found = SYSTEM_ROLES.find((candidate) => candidate.key === key)
  if (!found) throw new Error(`missing system role ${key}`)
  return found
}
const scopeOf = (key: SystemRoleKey, permission: PermissionKey) =>
  role(key).grants.find((grant) => grant.key === permission)?.scope

describe('permission catalogue', () => {
  it('names every permission subject:action in lower case', () => {
    for (const key of PERMISSION_KEYS) expect(key).toMatch(/^[a-z]+(\.[a-z]+)?:[a-z_]+$/)
  })

  it('files every permission under a declared group', () => {
    for (const key of PERMISSION_KEYS) expect(PERMISSION_GROUPS).toContain(PERMISSIONS[key].group)
  })

  it('derives subjects and message keys', () => {
    expect(subjectOf('patient:read')).toBe('patient')
    expect(subjectOf('portal.admin:access')).toBe('portal.admin')
    expect(permissionLabelKey('appointment:check_in')).toBe('permissions.appointment.check_in')
  })

  it('marks the clinical reads as protected health information', () => {
    for (const key of [
      'patient:read',
      'encounter:read',
      'prescription:read',
      'file:read',
    ] as const) {
      expect(PERMISSIONS[key].phi).toBe(true)
    }
  })
})

describe('system roles (section 7.4)', () => {
  it('seeds four roles with unique keys, highest priority first', () => {
    expect(SYSTEM_ROLES.map((r) => r.key)).toEqual(['admin', 'staff', 'doctor', 'patient'])
    const priorities = SYSTEM_ROLES.map((r) => r.priority)
    expect([...priorities].sort((a, b) => b - a)).toEqual(priorities)
  })

  it('grants every role its own portal', () => {
    for (const key of ['admin', 'staff', 'doctor', 'patient'] as const) {
      expect(scopeOf(key, `portal.${key}:access`)).toBe('CLINIC')
    }
  })

  it('gives Admin everything except the portals that need a doctor or patient profile', () => {
    const granted = new Set(role('admin').grants.map((grant) => grant.key))
    expect(granted.has('portal.doctor:access')).toBe(false)
    expect(granted.has('portal.patient:access')).toBe(false)
    expect(granted.size).toBe(PERMISSION_KEYS.length - 2)
  })

  it('lets Staff read clinical records but never write or sign them, and keeps them out of roles and audit', () => {
    expect(scopeOf('staff', 'encounter:read')).toBe('CLINIC')
    expect(scopeOf('staff', 'encounter:write')).toBeUndefined()
    expect(scopeOf('staff', 'encounter:sign')).toBeUndefined()
    expect(scopeOf('staff', 'prescription:issue')).toBeUndefined()
    expect(role('staff').grants.some((grant) => grant.key.startsWith('role:'))).toBe(false)
    expect(scopeOf('staff', 'audit:read')).toBeUndefined()
  })

  it('limits a Doctor to ASSIGNED on clinical records, never the whole clinic', () => {
    for (const key of [
      'patient:read',
      'encounter:read',
      'encounter:write',
      'prescription:issue',
    ] as const) {
      expect(scopeOf('doctor', key)).toBe('ASSIGNED')
    }
  })

  it('limits a Patient to OWN on everything personal', () => {
    for (const key of [
      'patient:read',
      'appointment:read',
      'encounter:read',
      'invoice:read',
      'file:read',
    ] as const) {
      expect(scopeOf('patient', key)).toBe('OWN')
    }
  })

  it('never grants the same permission twice within one role', () => {
    for (const systemRole of SYSTEM_ROLES) {
      const keys = systemRole.grants.map((grant) => grant.key)
      expect(new Set(keys).size).toBe(keys.length)
    }
  })

  it('has exactly one default role, for self-registering patients later', () => {
    expect(SYSTEM_ROLES.filter((r) => r.isDefault).map((r) => r.key)).toEqual(['patient'])
  })
})

describe('systemActor', () => {
  it('holds every permission at GLOBAL scope and is never a user', () => {
    const actor = systemActor('c1')
    expect(actor.kind).toBe('SYSTEM')
    expect(actor.permissions.size).toBe(PERMISSION_KEYS.length)
    expect([...actor.permissions.values()].every((scope) => scope === 'GLOBAL')).toBe(true)
    expect(actor.sessionId).toBeNull()
  })
})
