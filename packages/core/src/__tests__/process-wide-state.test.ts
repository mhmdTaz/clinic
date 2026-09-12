import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RequestContext } from '../context/request-context'
import type { PermissionKey } from '../modules/access/domain/permissions.catalog'
import type { Actor } from '../modules/access/domain/policy'
import type { Scope } from '../modules/access/domain/scopes'

/**
 * Next.js can give instrumentation, route handlers and pages their own copy of each
 * workspace package. Startup installs the audit sink and the scope resolvers in one copy;
 * requests read them from another. That is how signing in failed with
 * AuditSinkNotConfiguredError in the built app while every test running in a single module
 * graph passed.
 *
 * vi.resetModules() before each import loads a separate copy — the same situation in
 * miniature. Every test first asserts it really holds two copies, so none passes vacuously.
 *
 * Loading a package twice from cold means transpiling it twice, and @clinic/db is the largest
 * one in the workspace; under a full parallel run that has outgrown the 5s default. The generous
 * timeout is about transform time, not about anything these tests assert.
 */
const SLOW_IMPORT = 30_000

async function twoCopies<T>(load: () => Promise<T>): Promise<[T, T]> {
  vi.resetModules()
  const first = await load()
  vi.resetModules()
  const second = await load()
  return [first, second]
}

const actor: Actor = {
  kind: 'USER',
  userId: 'u1',
  clinicId: 'c1',
  displayName: 'Test Actor',
  roleKeys: [],
  permissions: new Map<PermissionKey, Scope>([['user:update', 'OWN']]),
  portals: [],
  preferredPortal: null,
  sessionId: 's1',
}

afterEach(async () => {
  // Any copy resets the shared state — which is the point.
  ;(await import('@clinic/db')).setAuditSink(null)
  ;(await import('../modules/access/domain/policy')).clearScopeResolvers()
})

describe('state shared across bundle copies', () => {
  it(
    'a model in one copy sees the audit sink installed by another',
    async () => {
      const [startup, route] = await twoCopies(() => import('@clinic/db'))
      expect(route.setAuditSink).not.toBe(startup.setAuditSink)

      startup.setAuditSink(() => undefined)
      expect(route.hasAuditSink()).toBe(true)
    },
    SLOW_IMPORT,
  )

  it(
    'the audit sink reads the request context that a route opened in another copy',
    async () => {
      const [route, sink] = await twoCopies(() => import('../context/request-context'))
      expect(sink.currentContext).not.toBe(route.currentContext)

      const context: RequestContext = {
        requestId: 'req-1',
        actorId: 'u1',
        actorType: 'USER',
        actorRoles: [],
      }
      expect(await route.runWithContext(context, async () => sink.currentContext())).toBe(context)
    },
    SLOW_IMPORT,
  )

  it(
    'a scope resolver registered at startup decides requests served by another copy',
    async () => {
      const [startup, route] = await twoCopies(() => import('../modules/access/domain/policy'))
      expect(route.decide).not.toBe(startup.decide)

      startup.installDefaultScopeResolvers()
      expect(await route.decide(actor, 'user:update', { clinicId: 'c1', id: 'u1' })).toEqual({
        allowed: true,
        scope: 'OWN',
      })
    },
    SLOW_IMPORT,
  )
})
