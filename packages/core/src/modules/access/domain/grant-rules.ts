import { PERMISSIONS, isPermissionKey, type PermissionKey } from './permissions.catalog'
import { isScope, scopeAtLeast, type PermissionMap, type Scope } from './scopes'

/**
 * The rules for editing access at runtime (sections 7.3 and 7.4). Pure functions: the roles
 * editor, role assignment and suspension all check a proposed state against these before a
 * single document is written.
 */

export interface GrantInput {
  key: string
  scope?: string | null
}

export interface Grant {
  key: PermissionKey
  scope: Scope
}

export type GrantIssueCode = 'UNKNOWN_PERMISSION' | 'SCOPE_NOT_ALLOWED' | 'SCOPE_NOT_APPLICABLE'

export interface GrantIssue {
  index: number
  key: string
  issue: GrantIssueCode
}

/**
 * Grants an administrator submits for a role, checked and sorted:
 *  - only permissions the catalogue defines
 *  - never GLOBAL, which crosses clinics and belongs to a platform operator, not a clinic
 *  - OWN and ASSIGNED only on scopable permissions, where they mean something
 */
export function validateGrants(input: readonly GrantInput[]): {
  grants: Grant[]
  issues: GrantIssue[]
} {
  const grants: Grant[] = []
  const issues: GrantIssue[] = []

  input.forEach((grant, index) => {
    if (!isPermissionKey(grant.key)) {
      issues.push({ index, key: grant.key, issue: 'UNKNOWN_PERMISSION' })
      return
    }
    const scope: Scope = isScope(grant.scope) ? grant.scope : 'CLINIC'
    if (scope === 'GLOBAL') {
      issues.push({ index, key: grant.key, issue: 'SCOPE_NOT_ALLOWED' })
      return
    }
    if (PERMISSIONS[grant.key].scopable !== true && scope !== 'CLINIC') {
      issues.push({ index, key: grant.key, issue: 'SCOPE_NOT_APPLICABLE' })
      return
    }
    grants.push({ key: grant.key, scope })
  })

  return { grants: grants.sort((a, b) => a.key.localeCompare(b.key)), issues }
}

/**
 * Portal permissions only open a door; every page behind it checks permissions of its own. They
 * are exempt from the rule below, so an administrator — who deliberately does not hold the doctor
 * and patient portals — can still assign the Doctor and Patient roles.
 */
const opensAPortal = (key: PermissionKey) => key.startsWith('portal.')

/**
 * The grants an actor could not hand out: a permission they do not hold, or hold at a narrower
 * scope. Nobody gives away more than they have, so a role editor cannot make someone — themselves
 * included — more powerful than they are.
 */
export function grantsBeyondActor(
  actorPermissions: PermissionMap,
  grants: readonly Grant[],
): PermissionKey[] {
  return grants
    .filter((grant) => {
      if (opensAPortal(grant.key)) return false
      const held = actorPermissions.get(grant.key)
      return !held || !scopeAtLeast(held, grant.scope)
    })
    .map((grant) => grant.key)
}

export interface GrantChanges {
  added: Grant[]
  removed: Grant[]
  rescoped: Array<{ key: PermissionKey; from: Scope; to: Scope }>
}

export function diffGrants(before: readonly Grant[], after: readonly Grant[]): GrantChanges {
  const previous = new Map(before.map((grant) => [grant.key, grant.scope]))
  const next = new Map(after.map((grant) => [grant.key, grant.scope]))
  return {
    added: after.filter((grant) => !previous.has(grant.key)),
    removed: before.filter((grant) => !next.has(grant.key)),
    rescoped: after
      .filter((grant) => previous.has(grant.key) && previous.get(grant.key) !== grant.scope)
      .map((grant) => ({
        key: grant.key,
        from: previous.get(grant.key) as Scope,
        to: grant.scope,
      })),
  }
}

/** What a change makes available that was not before: new grants, and scopes made wider. */
export function widenedGrants(changes: GrantChanges): Grant[] {
  return [
    ...changes.added,
    ...changes.rescoped
      .filter((change) => !scopeAtLeast(change.from, change.to))
      .map((change) => ({ key: change.key, scope: change.to })),
  ]
}

/** What someone needs to repair access: reach the admin portal, and read, edit and assign roles. */
export const ADMINISTRATION_KEYS: readonly PermissionKey[] = [
  'portal.admin:access',
  'role:read',
  'role:update',
  'role:assign',
]

export function grantsAdministration(permissions: ReadonlyArray<{ key: string }>): boolean {
  return permissions.some((grant) => (ADMINISTRATION_KEYS as readonly string[]).includes(grant.key))
}

export interface MembershipState {
  roles: ReadonlyMap<string, ReadonlyArray<{ key: string }>>
  activeUsers: ReadonlyArray<{ id: string; roleIds: readonly string[] }>
}

/**
 * True when at least one active user holds every administration permission across their roles.
 * A suspension, a removed role, a removed grant: each is checked against the state it would
 * leave, so a clinic cannot lock itself out of its own access control.
 */
export function administratorRemains(state: MembershipState): boolean {
  return state.activeUsers.some((user) => {
    const held = new Set(
      user.roleIds.flatMap((roleId) => (state.roles.get(roleId) ?? []).map((grant) => grant.key)),
    )
    return ADMINISTRATION_KEYS.every((key) => held.has(key))
  })
}

/** "Head Nurse" -> "head-nurse". A name with no Latin letters falls back to "role". */
export function roleKeyFrom(name: string): string {
  const key = name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return key === '' ? 'role' : key
}

/** The first of key, key-2, key-3 … that nothing else uses. */
export function uniqueKey(base: string, taken: Iterable<string>): string {
  const used = new Set(taken)
  if (!used.has(base)) return base
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base}-${suffix}`
    if (!used.has(candidate)) return candidate
  }
}
