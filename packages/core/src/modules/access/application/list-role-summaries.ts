import type { Actor } from '../domain/policy'
import { roleRepository } from '../infrastructure/role.repository'
import { assertCan } from './assert-can'

export interface RoleSummary {
  id: string
  key: string
  name: string
  description: string | null
  isSystem: boolean
  priority: number
  grantCount: number
  memberCount: number
}

export async function listRoleSummaries(actor: Actor): Promise<RoleSummary[]> {
  await assertCan(actor, 'role:read')
  const roles = await roleRepository.listWithMemberCounts(actor.clinicId)
  return roles.map((role) => ({
    id: role.id,
    key: role.key,
    name: role.name,
    description: role.description,
    isSystem: role.isSystem,
    priority: role.priority,
    grantCount: role.permissions.length,
    memberCount: role.memberCount,
  }))
}
