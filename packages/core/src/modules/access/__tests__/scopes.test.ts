import { describe, expect, it } from 'vitest'
import {
  decodePermissions,
  encodePermissions,
  toGrantList,
  unionGrants,
  widerScope,
  type PermissionMap,
} from '../domain/scopes'

describe('unionGrants', () => {
  it('takes the wider scope when two roles grant the same permission', () => {
    const { permissions } = unionGrants([
      { permissions: [{ key: 'patient:read', scope: 'OWN' }] },
      { permissions: [{ key: 'patient:read', scope: 'CLINIC' }] },
    ])
    expect(permissions.get('patient:read')).toBe('CLINIC')
  })

  it('gives the same answer whatever order the roles arrive in', () => {
    const own = { permissions: [{ key: 'encounter:read', scope: 'OWN' }] }
    const assigned = { permissions: [{ key: 'encounter:read', scope: 'ASSIGNED' }] }
    expect(unionGrants([own, assigned]).permissions.get('encounter:read')).toBe('ASSIGNED')
    expect(unionGrants([assigned, own]).permissions.get('encounter:read')).toBe('ASSIGNED')
  })

  it('ignores and reports stored keys the catalogue no longer defines', () => {
    const result = unionGrants([
      {
        permissions: [
          { key: 'patient:teleport', scope: 'CLINIC' },
          { key: 'patient:read', scope: 'OWN' },
        ],
      },
    ])
    expect([...result.permissions.keys()]).toEqual(['patient:read'])
    expect(result.unknownKeys).toEqual(['patient:teleport'])
  })

  it('reads a narrow scope on a non-scopable permission as CLINIC', () => {
    const { permissions } = unionGrants([{ permissions: [{ key: 'invoice:void', scope: 'OWN' }] }])
    expect(permissions.get('invoice:void')).toBe('CLINIC')
  })

  it('keeps GLOBAL on a non-scopable permission — that is how a platform grant crosses clinics', () => {
    const { permissions } = unionGrants([
      { permissions: [{ key: 'invoice:void', scope: 'GLOBAL' }] },
    ])
    expect(permissions.get('invoice:void')).toBe('GLOBAL')
  })

  it('treats a missing or unrecognised scope as CLINIC', () => {
    const { permissions } = unionGrants([
      {
        permissions: [
          { key: 'clinic:read' },
          { key: 'patient:read', scope: 'EVERYWHERE' },
          { key: 'appointment:read', scope: null },
        ],
      },
    ])
    expect(permissions.get('clinic:read')).toBe('CLINIC')
    expect(permissions.get('patient:read')).toBe('CLINIC')
    expect(permissions.get('appointment:read')).toBe('CLINIC')
  })

  it('grants nothing for no roles', () => {
    expect(unionGrants([]).permissions.size).toBe(0)
  })
})

describe('widerScope', () => {
  it('ranks OWN < ASSIGNED < CLINIC < GLOBAL', () => {
    expect(widerScope('OWN', 'ASSIGNED')).toBe('ASSIGNED')
    expect(widerScope('CLINIC', 'ASSIGNED')).toBe('CLINIC')
    expect(widerScope('GLOBAL', 'CLINIC')).toBe('GLOBAL')
    expect(widerScope('OWN', 'OWN')).toBe('OWN')
  })
})

describe('token encoding', () => {
  it('round-trips a permission map', () => {
    const map: PermissionMap = new Map([
      ['patient:read', 'OWN'],
      ['encounter:read', 'ASSIGNED'],
      ['clinic:read', 'CLINIC'],
      ['audit:read', 'GLOBAL'],
    ])
    expect(decodePermissions(encodePermissions(map))).toEqual(map)
  })

  it('uses one character per scope', () => {
    expect(encodePermissions(new Map([['patient:read', 'OWN']]))).toEqual({ 'patient:read': 'O' })
  })

  it('drops unknown keys and unknown codes rather than trusting them', () => {
    const decoded = decodePermissions({ 'patient:read': 'C', 'made:up': 'G', 'clinic:read': 'X' })
    expect([...decoded]).toEqual([['patient:read', 'CLINIC']])
  })
})

describe('toGrantList', () => {
  it('is sorted by key so the output is stable', () => {
    const list = toGrantList(
      new Map([
        ['user:read', 'OWN'],
        ['appointment:read', 'CLINIC'],
      ]),
    )
    expect(list.map((grant) => grant.key)).toEqual(['appointment:read', 'user:read'])
  })
})
