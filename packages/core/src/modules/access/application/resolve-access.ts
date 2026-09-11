import type { PortalKey } from '@clinic/config'
import { orderPortals } from '../domain/portals'
import { unionGrants, type PermissionMap } from '../domain/scopes'
import { roleRepository } from '../infrastructure/role.repository'

export interface ResolvedAccess {
  permissions: PermissionMap
  portals: PortalKey[]
  roles: Array<{ id: string; key: string; name: string; priority: number }>
}

/**
 * Effective permissions for a set of role ids: two indexed reads and a union, since the
 * grants are embedded in the roles (section 8.5). Role ids that no longer exist
 * contribute nothing, which is the safe direction.
 */
export async function resolveAccess(
  clinicId: string,
  roleIds: readonly string[],
): Promise<ResolvedAccess> {
  const roles = await roleRepository.findByIds(clinicId, roleIds)
  const { permissions, unknownKeys } = unionGrants(roles)

  if (unknownKeys.length > 0) {
    console.warn('[access] ignored grants that are not in the permission catalogue', {
      clinicId,
      unknownKeys,
    })
  }

  const portals = orderPortals(
    permissions,
    roles.map((role) => ({
      priority: role.priority,
      permissionKeys: role.permissions.map((grant) => grant.key),
    })),
  )

  return {
    permissions,
    portals,
    roles: roles
      .map(({ id, key, name, priority }) => ({ id, key, name, priority }))
      .sort((a, b) => b.priority - a.priority),
  }
}
