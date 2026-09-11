import { processSingleton, type PortalKey } from '@clinic/config'
import { subjectOf, type PermissionKey } from './permissions.catalog'
import type { PermissionMap, Scope } from './scopes'

export type ActorKind = 'USER' | 'SYSTEM'

/**
 * The principal a use case runs as (section 7.5). Built once per request from a
 * verified session — never from anything the client sent.
 */
export interface Actor {
  kind: ActorKind
  userId: string
  clinicId: string
  displayName: string
  roleKeys: string[]
  permissions: PermissionMap
  /** Portals the actor may enter, most relevant first. */
  portals: PortalKey[]
  preferredPortal: PortalKey | null
  /** The refresh-token family this request belongs to; null for system actors. */
  sessionId: string | null
  /** Resolved from doctor and patient profiles, which arrive in Phase 2. */
  doctorId?: string
  patientId?: string
  impersonatorId?: string
}

export interface ScopedResource {
  clinicId: string
  [field: string]: unknown
}

export type NarrowScope = Extract<Scope, 'OWN' | 'ASSIGNED'>

export type ScopeResolver = (
  actor: Actor,
  resource: ScopedResource,
  scope: NarrowScope,
) => boolean | Promise<boolean>

// Registered at startup, consulted by whichever bundle serves the request.
const resolvers = processSingleton('access:scope-resolvers', () => new Map<string, ScopeResolver>())

/** Each module registers how OWN and ASSIGNED map onto its own documents. */
export function registerScopeResolver(subject: string, resolver: ScopeResolver): void {
  resolvers.set(subject, resolver)
}

/** Test-only. */
export function clearScopeResolvers(): void {
  resolvers.clear()
}

export type DenialReason = 'NOT_GRANTED' | 'OTHER_CLINIC' | 'OUT_OF_SCOPE' | 'NO_SCOPE_RESOLVER'
export type Decision = { allowed: true; scope: Scope } | { allowed: false; reason: DenialReason }

/**
 * Two-stage evaluation (section 7.5):
 *   1. Does the actor hold the permission at all? Set membership, no I/O.
 *   2. Given a specific resource, does the actor's scope reach it?
 *
 * With no resource the check is collection-level: the scope then narrows the query
 * rather than filtering loaded rows (see the scope filters in each module).
 */
export async function decide(
  actor: Actor,
  permission: PermissionKey,
  resource?: ScopedResource,
): Promise<Decision> {
  const scope = actor.permissions.get(permission)
  if (!scope) return { allowed: false, reason: 'NOT_GRANTED' }
  if (!resource) return { allowed: true, scope }
  if (scope === 'GLOBAL') return { allowed: true, scope }

  // The hard tenant boundary: below GLOBAL, nothing crosses clinics.
  if (resource.clinicId !== actor.clinicId) return { allowed: false, reason: 'OTHER_CLINIC' }
  if (scope === 'CLINIC') return { allowed: true, scope }

  // Fail CLOSED. An OWN or ASSIGNED grant on a subject with no registered resolver
  // denies: forgetting to register one must never turn into a silent allow.
  const resolver = resolvers.get(subjectOf(permission))
  if (!resolver) return { allowed: false, reason: 'NO_SCOPE_RESOLVER' }

  return (await resolver(actor, resource, scope))
    ? { allowed: true, scope }
    : { allowed: false, reason: 'OUT_OF_SCOPE' }
}

export async function can(
  actor: Actor,
  permission: PermissionKey,
  resource?: ScopedResource,
): Promise<boolean> {
  return (await decide(actor, permission, resource)).allowed
}

/** Coarse and synchronous — for menus, route gates and UI affordances only. */
export function holds(actor: Pick<Actor, 'permissions'>, permission: PermissionKey): boolean {
  return actor.permissions.has(permission)
}

/**
 * Resolvers owned by the access module itself. Feature modules register their own
 * (patients, encounters...) as they arrive; the ASSIGNED rule for clinical records is
 * ADR-0004 and deliberately not decided here.
 */
export function installDefaultScopeResolvers(): void {
  // OWN on a user reaches exactly one document: the actor's own account.
  registerScopeResolver('user', (actor, resource, scope) => {
    return scope === 'OWN' && resource.id === actor.userId
  })
}
