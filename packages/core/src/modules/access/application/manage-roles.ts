import { nameKey } from '@clinic/config'
import type {
  CreateRoleRequest,
  PermissionCatalogueEntry,
  RoleDetail,
  UpdateRoleRequest,
} from '@clinic/contracts'
import { BusinessRuleError, ConflictError, NotFoundError, ValidationError } from '../../../errors'
import { runInTransaction } from '../../../transaction'
import { recordAudit } from '../../audit'
import {
  diffGrants,
  grantsBeyondActor,
  roleKeyFrom,
  uniqueKey,
  validateGrants,
  widenedGrants,
  type GrantInput,
} from '../domain/grant-rules'
import { PERMISSIONS, PERMISSION_KEYS } from '../domain/permissions.catalog'
import type { Actor } from '../domain/policy'
import { toGrantList, unionGrants } from '../domain/scopes'
import { SYSTEM_ROLES } from '../domain/system-roles'
import { permissionVersionRepository } from '../infrastructure/permission-version.repository'
import { roleRepository, type StoredRole } from '../infrastructure/role.repository'
import { guardAdministration } from './administration-guard'
import { assertCan } from './assert-can'

/** Stored grants as the engine reads them: unknown keys dropped, scopes normalised (7.3). */
const effectiveGrants = (role: StoredRole) => toGrantList(unionGrants([role]).permissions)

function toDetail(role: StoredRole, memberCount: number): RoleDetail {
  const permissions = effectiveGrants(role)
  return {
    id: role.id,
    key: role.key,
    name: role.name,
    description: role.description,
    isSystem: role.isSystem,
    priority: role.priority,
    grantCount: permissions.length,
    memberCount,
    permissions,
  }
}

/** The catalogue the permission matrix renders from — a new permission appears here unedited. */
export async function getPermissionCatalogue(actor: Actor): Promise<PermissionCatalogueEntry[]> {
  await assertCan(actor, 'role:read')
  return PERMISSION_KEYS.map((key) => ({
    key,
    group: PERMISSIONS[key].group,
    scopable: PERMISSIONS[key].scopable === true,
    dangerous: PERMISSIONS[key].dangerous === true,
    phi: PERMISSIONS[key].phi === true,
  }))
}

export async function getRole(actor: Actor, roleId: string): Promise<RoleDetail> {
  await assertCan(actor, 'role:read')
  const role = await roleRepository.findById(actor.clinicId, roleId)
  if (!role) throw new NotFoundError('Role')
  return toDetail(role, await roleRepository.countMembers(actor.clinicId, role.id))
}

function assertNameFree(roles: readonly StoredRole[], name: string, exceptId?: string): void {
  const wanted = nameKey(name)
  if (roles.some((role) => role.id !== exceptId && nameKey(role.name) === wanted)) {
    throw new ConflictError('ROLE_NAME_TAKEN', 'Another role already has this name.', [
      { field: 'name', issue: 'ROLE_NAME_TAKEN' },
    ])
  }
}

/**
 * Refuses grants beyond the actor's own access. Each detail names the permission in its field
 * ("permissions.patient:delete"), so the matrix can mark the exact rows.
 */
function assertWithinActor(
  actor: Actor,
  grants: Parameters<typeof grantsBeyondActor>[1],
  fieldFor: (key: string) => string,
) {
  const beyond = grantsBeyondActor(actor.permissions, grants)
  if (beyond.length > 0) {
    throw new BusinessRuleError(
      'GRANT_EXCEEDS_YOUR_ACCESS',
      'A role cannot grant permissions you do not hold yourself.',
      [...new Set(beyond.map(fieldFor))].map((field) => ({
        field,
        issue: 'GRANT_EXCEEDS_YOUR_ACCESS',
      })),
    )
  }
}

/**
 * A new custom role, empty or copied from an existing one. Custom roles take priority 0, so a
 * person holding a system role still lands on that role's portal first.
 */
export async function createRole(actor: Actor, input: CreateRoleRequest): Promise<RoleDetail> {
  await assertCan(actor, 'role:create')
  const roles = await roleRepository.listAll(actor.clinicId)
  assertNameFree(roles, input.name)

  let grants: ReturnType<typeof effectiveGrants> = []
  if (input.copyFromRoleId) {
    const source = roles.find((role) => role.id === input.copyFromRoleId)
    if (!source) {
      throw new ValidationError('The role to copy from was not found.', [
        { field: 'copyFromRoleId', issue: 'NOT_FOUND' },
      ])
    }
    grants = effectiveGrants(source).filter((grant) => grant.scope !== 'GLOBAL')
    assertWithinActor(actor, grants, () => 'copyFromRoleId')
  }

  const key = uniqueKey(roleKeyFrom(input.name), [
    ...roles.map((role) => role.key),
    ...SYSTEM_ROLES.map((role) => role.key),
  ])
  const role = await roleRepository.create({
    clinicId: actor.clinicId,
    key,
    name: input.name,
    description: input.description,
    permissions: grants,
  })
  return toDetail(role, 0)
}

export async function updateRole(
  actor: Actor,
  roleId: string,
  input: UpdateRoleRequest,
): Promise<RoleDetail> {
  await assertCan(actor, 'role:update')
  const roles = await roleRepository.listAll(actor.clinicId)
  const role = roles.find((candidate) => candidate.id === roleId)
  if (!role) throw new NotFoundError('Role')
  if (role.isSystem) {
    throw new BusinessRuleError(
      'SYSTEM_ROLE_PROTECTED',
      'A system role keeps its name; its permissions can still be edited.',
    )
  }
  assertNameFree(roles, input.name, role.id)

  const updated = await roleRepository.updateDetails(actor.clinicId, role.id, input)
  if (!updated) throw new NotFoundError('Role')
  return toDetail(updated, await roleRepository.countMembers(actor.clinicId, role.id))
}

/**
 * Replaces a role's grants. Removing is always allowed; adding or widening is limited to what the
 * editor holds; and no change may leave the clinic without an administrator. The permission
 * version moves in the same transaction, so every member's next request sees the new grants.
 */
export async function setRolePermissions(
  actor: Actor,
  roleId: string,
  submitted: readonly GrantInput[],
): Promise<RoleDetail> {
  await assertCan(actor, 'role:update')
  const roles = await roleRepository.listAll(actor.clinicId)
  const role = roles.find((candidate) => candidate.id === roleId)
  if (!role) throw new NotFoundError('Role')

  const { grants, issues } = validateGrants(submitted)
  if (issues.length > 0) {
    throw new ValidationError(
      'Some permissions cannot be granted this way.',
      issues.map(({ index, issue }) => ({ field: `permissions.${index}`, issue })),
    )
  }

  const changes = diffGrants(effectiveGrants(role), grants)
  const memberCount = await roleRepository.countMembers(actor.clinicId, role.id)
  if (changes.added.length + changes.removed.length + changes.rescoped.length === 0) {
    return toDetail(role, memberCount)
  }

  assertWithinActor(actor, widenedGrants(changes), (key) => `permissions.${key}`)
  await guardAdministration(actor.clinicId, { roles, nextGrants: new Map([[role.id, grants]]) })

  const updated = await runInTransaction(async (tx) => {
    const saved = await roleRepository.setPermissions(actor.clinicId, role.id, grants, tx)
    await permissionVersionRepository.bump(actor.clinicId, tx)
    return saved
  })
  if (!updated) throw new NotFoundError('Role')

  await recordAudit({
    action: 'role.permissions_changed',
    category: 'ACCESS_CONTROL',
    severity: 'NOTICE',
    clinicId: actor.clinicId,
    entity: { type: 'Role', id: role.id, label: role.name },
    metadata: {
      added: changes.added,
      removed: changes.removed,
      rescoped: changes.rescoped,
      memberCount,
    },
  })

  return toDetail(updated, memberCount)
}

/** Only a custom role that nobody holds. System roles are the clinic's starting point. */
export async function deleteRole(actor: Actor, roleId: string): Promise<void> {
  await assertCan(actor, 'role:delete')
  const role = await roleRepository.findById(actor.clinicId, roleId)
  if (!role) throw new NotFoundError('Role')
  if (role.isSystem) {
    throw new BusinessRuleError('SYSTEM_ROLE_PROTECTED', 'System roles cannot be deleted.')
  }
  if ((await roleRepository.countMembers(actor.clinicId, role.id)) > 0) {
    throw new ConflictError(
      'ROLE_IN_USE',
      'Remove this role from everyone who holds it before deleting it.',
    )
  }
  if (!(await roleRepository.delete(actor.clinicId, role.id))) throw new NotFoundError('Role')
}
