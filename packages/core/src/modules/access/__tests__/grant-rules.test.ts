import { describe, expect, it } from 'vitest'
import {
  administratorRemains,
  diffGrants,
  grantsBeyondActor,
  roleKeyFrom,
  uniqueKey,
  validateGrants,
  widenedGrants,
  type Grant,
} from '../domain/grant-rules'
import type { PermissionKey } from '../domain/permissions.catalog'
import type { PermissionMap, Scope } from '../domain/scopes'

const holding = (...grants: Array<[PermissionKey, Scope]>): PermissionMap => new Map(grants)

describe('validateGrants', () => {
  it('keeps catalogue permissions, sorted, reading a missing scope as CLINIC', () => {
    expect(validateGrants([{ key: 'patient:read', scope: 'OWN' }, { key: 'clinic:read' }])).toEqual(
      {
        grants: [
          { key: 'clinic:read', scope: 'CLINIC' },
          { key: 'patient:read', scope: 'OWN' },
        ],
        issues: [],
      },
    )
  })

  it('refuses unknown permissions, GLOBAL, and narrow scopes where they mean nothing', () => {
    const { issues } = validateGrants([
      { key: 'patient:teleport', scope: 'CLINIC' },
      { key: 'patient:read', scope: 'GLOBAL' },
      { key: 'role:assign', scope: 'OWN' },
    ])
    expect(issues.map((issue) => issue.issue)).toEqual([
      'UNKNOWN_PERMISSION',
      'SCOPE_NOT_ALLOWED',
      'SCOPE_NOT_APPLICABLE',
    ])
  })
})

describe('grantsBeyondActor', () => {
  it('flags what the actor does not hold, or holds more narrowly', () => {
    const actor = holding(['patient:read', 'OWN'], ['role:read', 'CLINIC'])
    const grants: Grant[] = [
      { key: 'patient:read', scope: 'CLINIC' },
      { key: 'role:read', scope: 'CLINIC' },
      { key: 'audit:read', scope: 'CLINIC' },
    ]
    expect(grantsBeyondActor(actor, grants)).toEqual(['patient:read', 'audit:read'])
  })

  it('lets anyone hand out a portal door, since every page behind it checks its own permissions', () => {
    expect(
      grantsBeyondActor(holding(), [{ key: 'portal.doctor:access', scope: 'CLINIC' }]),
    ).toEqual([])
  })
})

describe('diffGrants and widenedGrants', () => {
  it('separates additions, removals and scope changes, and widening from narrowing', () => {
    const changes = diffGrants(
      [
        { key: 'patient:read', scope: 'OWN' },
        { key: 'patient:update', scope: 'CLINIC' },
        { key: 'clinic:read', scope: 'CLINIC' },
      ],
      [
        { key: 'patient:read', scope: 'CLINIC' },
        { key: 'patient:update', scope: 'OWN' },
        { key: 'audit:read', scope: 'CLINIC' },
      ],
    )
    expect(changes.added.map((grant) => grant.key)).toEqual(['audit:read'])
    expect(changes.removed.map((grant) => grant.key)).toEqual(['clinic:read'])
    expect(widenedGrants(changes)).toEqual([
      { key: 'audit:read', scope: 'CLINIC' },
      { key: 'patient:read', scope: 'CLINIC' },
    ])
  })
})

describe('administratorRemains', () => {
  const roles = new Map([
    [
      'admin',
      [
        { key: 'portal.admin:access' },
        { key: 'role:read' },
        { key: 'role:update' },
        { key: 'role:assign' },
      ],
    ],
    ['half-a', [{ key: 'portal.admin:access' }, { key: 'role:read' }]],
    ['half-b', [{ key: 'role:update' }, { key: 'role:assign' }]],
  ])

  it('counts administration assembled from several roles', () => {
    expect(
      administratorRemains({ roles, activeUsers: [{ id: 'u1', roleIds: ['half-a', 'half-b'] }] }),
    ).toBe(true)
  })

  it('is false when nobody holds every administration permission', () => {
    expect(administratorRemains({ roles, activeUsers: [{ id: 'u1', roleIds: ['half-a'] }] })).toBe(
      false,
    )
    expect(administratorRemains({ roles, activeUsers: [] })).toBe(false)
  })
})

describe('role keys', () => {
  it('slugs a name and steps around keys already taken', () => {
    expect(roleKeyFrom('Head Nurse')).toBe('head-nurse')
    expect(roleKeyFrom('Réception & Accueil')).toBe('reception-accueil')
    expect(roleKeyFrom('ممرضة')).toBe('role')
    expect(uniqueKey('staff', ['staff', 'staff-2'])).toBe('staff-3')
  })
})
