import type { UserStatus } from '@clinic/config'
import type { RoleRef } from '@clinic/contracts'
import { BusinessRuleError, ValidationError } from '../../../errors'
import type { Transaction } from '../../../transaction'
import { grantsBeyondActor } from '../domain/grant-rules'
import type { Actor } from '../domain/policy'
import { toGrantList, unionGrants } from '../domain/scopes'
import type { SystemRoleKey } from '../domain/system-roles'
import { permissionVersionRepository } from '../infrastructure/permission-version.repository'
import { roleRepository, type StoredRole } from '../infrastructure/role.repository'
import { guardAdministration } from './administration-guard'
import { assertCan } from './assert-can'

const refOf = (role: StoredRole): RoleRef => ({ id: role.id, key: role.key, name: role.name })

/**
 * Checks a change to one user's roles before anything is written: that the actor may assign
 * roles, is not editing their own, hands out nothing beyond their own access, and leaves the
 * clinic an administrator. Returns what the change adds and removes, for the audit entries.
 */
export async function authorizeRoleAssignment(
  actor: Actor,
  change: {
    userId: string
    userStatus: UserStatus
    currentRoleIds: readonly string[]
    nextRoleIds: readonly string[]
  },
): Promise<{ added: RoleRef[]; removed: RoleRef[]; roles: RoleRef[] }> {
  await assertCan(actor, 'role:assign', {
    clinicId: actor.clinicId,
    type: 'User',
    id: change.userId,
  })
  if (change.userId === actor.userId) {
    throw new BusinessRuleError(
      'CANNOT_CHANGE_OWN_ROLES',
      'Ask another administrator to change your roles.',
    )
  }

  const roles = await roleRepository.listAll(actor.clinicId)
  const byId = new Map(roles.map((role) => [role.id, role]))
  const next = [...new Set(change.nextRoleIds)]
  const unknown = next.filter((id) => !byId.has(id))
  if (unknown.length > 0) {
    throw new ValidationError('Some roles were not found.', [
      { field: 'roleIds', issue: 'UNKNOWN_ROLE' },
    ])
  }

  const current = new Set(change.currentRoleIds)
  const added = next.filter((id) => !current.has(id)).map((id) => byId.get(id) as StoredRole)
  const removed = [...current]
    .filter((id) => !next.includes(id) && byId.has(id))
    .map((id) => byId.get(id) as StoredRole)

  // Taking a role away never makes anyone more powerful; only additions are checked.
  const beyond = grantsBeyondActor(
    actor.permissions,
    added.flatMap((role) => toGrantList(unionGrants([role]).permissions)),
  )
  if (beyond.length > 0) {
    throw new BusinessRuleError(
      'ROLE_EXCEEDS_YOUR_ACCESS',
      'You cannot assign a role that grants permissions you do not hold yourself.',
      [{ field: 'roleIds', issue: 'ROLE_EXCEEDS_YOUR_ACCESS' }],
    )
  }

  if (removed.length > 0 && change.userStatus === 'ACTIVE') {
    await guardAdministration(actor.clinicId, {
      roles,
      applyToMembers: (members) =>
        members.map((member) =>
          member.id === change.userId ? { ...member, roleIds: [...next] } : member,
        ),
    })
  }

  return {
    added: added.map(refOf),
    removed: removed.map(refOf),
    roles: next.map((id) => refOf(byId.get(id) as StoredRole)),
  }
}

/** Refuses to take `userId` out of the active users if they are the last administrator. */
export async function assertAdministratorRemainsWithout(
  clinicId: string,
  userId: string,
): Promise<void> {
  const roles = await roleRepository.listAll(clinicId)
  await guardAdministration(clinicId, {
    roles,
    applyToMembers: (members) => members.filter((member) => member.id !== userId),
  })
}

/** Moves every signed-in session onto current grants at its next request (section 7.7). */
export function bumpPermissionVersion(clinicId: string, tx?: Transaction): Promise<void> {
  return permissionVersionRepository.bump(clinicId, tx)
}

/** A seeded role by key — how creating a doctor or inviting a patient finds its role. */
export async function findSystemRole(
  clinicId: string,
  key: SystemRoleKey,
): Promise<RoleRef | null> {
  const role = await roleRepository.findByKey(clinicId, key)
  return role?.isSystem ? refOf(role) : null
}

/** Every role by id, for rendering the roles a list of users holds. */
export async function roleDirectory(clinicId: string): Promise<Map<string, RoleRef>> {
  const roles = await roleRepository.listAll(clinicId)
  return new Map(roles.map((role) => [role.id, refOf(role)]))
}
