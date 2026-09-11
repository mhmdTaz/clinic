import { beforeEach, describe, expect, it } from 'vitest'
import type { PermissionKey } from '../domain/permissions.catalog'
import {
  can,
  clearScopeResolvers,
  decide,
  holds,
  installDefaultScopeResolvers,
  registerScopeResolver,
  type Actor,
} from '../domain/policy'
import type { Scope } from '../domain/scopes'

function actorWith(grants: Array<[PermissionKey, Scope]>, overrides: Partial<Actor> = {}): Actor {
  return {
    kind: 'USER',
    userId: 'u1',
    clinicId: 'c1',
    displayName: 'Test Actor',
    roleKeys: [],
    permissions: new Map(grants),
    portals: [],
    preferredPortal: null,
    sessionId: 's1',
    ...overrides,
  }
}

beforeEach(() => {
  clearScopeResolvers()
})

describe('decide', () => {
  it('denies a permission that was never granted', async () => {
    expect(await decide(actorWith([]), 'patient:read')).toEqual({
      allowed: false,
      reason: 'NOT_GRANTED',
    })
  })

  it('allows a collection-level check at any scope — the scope narrows the query instead', async () => {
    expect(await can(actorWith([['patient:read', 'OWN']]), 'patient:read')).toBe(true)
  })

  it('never crosses clinics below GLOBAL', async () => {
    const actor = actorWith([['patient:read', 'CLINIC']])
    expect(await decide(actor, 'patient:read', { clinicId: 'c2', id: 'p1' })).toEqual({
      allowed: false,
      reason: 'OTHER_CLINIC',
    })
  })

  it('lets a GLOBAL grant cross clinics', async () => {
    const actor = actorWith([['patient:read', 'GLOBAL']])
    expect(await can(actor, 'patient:read', { clinicId: 'c2', id: 'p1' })).toBe(true)
  })

  it('allows CLINIC scope on any resource in the clinic', async () => {
    const actor = actorWith([['patient:read', 'CLINIC']])
    expect(await can(actor, 'patient:read', { clinicId: 'c1', id: 'anyone' })).toBe(true)
  })

  it('FAILS CLOSED when an OWN grant has no resolver registered', async () => {
    const actor = actorWith([['patient:read', 'OWN']])
    expect(await decide(actor, 'patient:read', { clinicId: 'c1', id: 'p1' })).toEqual({
      allowed: false,
      reason: 'NO_SCOPE_RESOLVER',
    })
  })

  it('also fails closed for ASSIGNED — the clinical rule is ADR-0004 and not decided yet', async () => {
    const actor = actorWith([['encounter:read', 'ASSIGNED']])
    expect(await can(actor, 'encounter:read', { clinicId: 'c1', doctorId: 'u1' })).toBe(false)
  })

  it('defers OWN and ASSIGNED to the subject resolver', async () => {
    registerScopeResolver('patient', (actor, resource) => resource.ownerId === actor.userId)
    const actor = actorWith([['patient:read', 'OWN']])
    expect(await can(actor, 'patient:read', { clinicId: 'c1', ownerId: 'u1' })).toBe(true)
    expect(await decide(actor, 'patient:read', { clinicId: 'c1', ownerId: 'u2' })).toEqual({
      allowed: false,
      reason: 'OUT_OF_SCOPE',
    })
  })

  it('checks the clinic boundary before ever asking the resolver', async () => {
    let asked = false
    registerScopeResolver('patient', () => {
      asked = true
      return true
    })
    const actor = actorWith([['patient:read', 'OWN']])
    expect(await can(actor, 'patient:read', { clinicId: 'c2', ownerId: 'u1' })).toBe(false)
    expect(asked).toBe(false)
  })

  it('tells the resolver which narrow scope it is answering for', async () => {
    const seen: string[] = []
    registerScopeResolver('encounter', (_actor, _resource, scope) => {
      seen.push(scope)
      return true
    })
    await can(actorWith([['encounter:read', 'ASSIGNED']]), 'encounter:read', { clinicId: 'c1' })
    expect(seen).toEqual(['ASSIGNED'])
  })

  it('supports asynchronous resolvers', async () => {
    registerScopeResolver('ticket', async () => Promise.resolve(true))
    expect(await can(actorWith([['ticket:read', 'OWN']]), 'ticket:read', { clinicId: 'c1' })).toBe(
      true,
    )
  })
})

describe('holds', () => {
  it('is a plain membership check at any scope', () => {
    const actor = actorWith([['patient:read', 'OWN']])
    expect(holds(actor, 'patient:read')).toBe(true)
    expect(holds(actor, 'patient:update')).toBe(false)
  })
})

describe('default resolvers', () => {
  it('lets OWN on a user reach exactly the actor’s own account', async () => {
    installDefaultScopeResolvers()
    const actor = actorWith([['user:update', 'OWN']])
    expect(await can(actor, 'user:update', { clinicId: 'c1', id: 'u1' })).toBe(true)
    expect(await can(actor, 'user:update', { clinicId: 'c1', id: 'u2' })).toBe(false)
  })
})
