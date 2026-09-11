import type { PermissionScope } from '@clinic/config'
import { PERMISSIONS, isPermissionKey, type PermissionKey } from './permissions.catalog'

export type Scope = PermissionScope
export type PermissionMap = Map<PermissionKey, Scope>

const RANK: Record<Scope, number> = { OWN: 1, ASSIGNED: 2, CLINIC: 3, GLOBAL: 4 }

export function isScope(value: unknown): value is Scope {
  return value === 'OWN' || value === 'ASSIGNED' || value === 'CLINIC' || value === 'GLOBAL'
}

export function widerScope(a: Scope, b: Scope): Scope {
  return RANK[a] >= RANK[b] ? a : b
}

/** True when a grant at `held` reaches at least the rows a grant at `needed` would. */
export function scopeAtLeast(held: Scope, needed: Scope): boolean {
  return RANK[held] >= RANK[needed]
}

export interface GrantInput {
  key: string
  scope?: string | null
}

export interface RoleGrantsInput {
  permissions: readonly GrantInput[]
}

export interface EffectivePermissions {
  permissions: PermissionMap
  /** Keys found in stored grants that the catalogue no longer defines. */
  unknownKeys: string[]
}

/**
 * Unions grants across every role a user holds. When two roles grant the same
 * permission, the wider scope wins (section 7.3).
 *
 * Two defensive rules:
 *  - A stored key the catalogue no longer defines is IGNORED and reported, never
 *    granted. Removing a permission from code must not leave it alive in the data.
 *  - A non-scopable permission stored with OWN or ASSIGNED is read as CLINIC, since a
 *    narrower scope means nothing there. GLOBAL is kept: it is how a platform-level
 *    grant crosses clinics.
 */
export function unionGrants(roles: readonly RoleGrantsInput[]): EffectivePermissions {
  const permissions: PermissionMap = new Map()
  const unknown = new Set<string>()

  for (const role of roles) {
    for (const grant of role.permissions) {
      if (!isPermissionKey(grant.key)) {
        unknown.add(grant.key)
        continue
      }
      const requested: Scope = isScope(grant.scope) ? grant.scope : 'CLINIC'
      const scopable = PERMISSIONS[grant.key].scopable === true
      const scope: Scope = scopable || requested === 'GLOBAL' ? requested : 'CLINIC'

      const existing = permissions.get(grant.key)
      permissions.set(grant.key, existing ? widerScope(existing, scope) : scope)
    }
  }

  return { permissions, unknownKeys: [...unknown].sort() }
}

const SCOPE_CODES = { OWN: 'O', ASSIGNED: 'A', CLINIC: 'C', GLOBAL: 'G' } as const
export type ScopeCode = (typeof SCOPE_CODES)[Scope]
const CODE_TO_SCOPE: Record<string, Scope> = { O: 'OWN', A: 'ASSIGNED', C: 'CLINIC', G: 'GLOBAL' }

/**
 * Compact form for the session token (section 10.3): one character per scope keeps
 * an admin's full permission set comfortably inside a 4 KB cookie.
 */
export function encodePermissions(map: PermissionMap): Record<string, ScopeCode> {
  const encoded: Record<string, ScopeCode> = {}
  for (const [key, scope] of map) encoded[key] = SCOPE_CODES[scope]
  return encoded
}

/** Unknown keys and codes are dropped, never trusted. */
export function decodePermissions(encoded: Record<string, string>): PermissionMap {
  const map: PermissionMap = new Map()
  for (const [key, code] of Object.entries(encoded)) {
    const scope = CODE_TO_SCOPE[code]
    if (scope && isPermissionKey(key)) map.set(key, scope)
  }
  return map
}

export function toGrantList(map: PermissionMap): Array<{ key: PermissionKey; scope: Scope }> {
  return [...map].map(([key, scope]) => ({ key, scope })).sort((a, b) => a.key.localeCompare(b.key))
}
