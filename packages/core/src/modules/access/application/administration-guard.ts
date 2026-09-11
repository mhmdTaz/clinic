import { BusinessRuleError } from '../../../errors'
import { administratorRemains, grantsAdministration } from '../domain/grant-rules'
import { roleRepository, type StoredRole } from '../infrastructure/role.repository'

type Membership = { id: string; roleIds: string[] }

/**
 * Refuses a change that would leave no active user able to administer roles.
 *
 * Only a change from "someone can" to "nobody can" is refused. A clinic still being set up —
 * where nobody holds every administration permission yet — is not blocked from getting there.
 */
export async function guardAdministration(
  clinicId: string,
  change: {
    roles: readonly StoredRole[]
    /** Replacement grants for roles the change edits. */
    nextGrants?: ReadonlyMap<string, ReadonlyArray<{ key: string }>>
    /** The active memberships as they would be after the change. */
    applyToMembers?: (members: Membership[]) => Membership[]
  },
): Promise<void> {
  const next = change.nextGrants ?? new Map()
  const candidateRoleIds = change.roles
    .filter(
      (role) =>
        grantsAdministration(role.permissions) || grantsAdministration(next.get(role.id) ?? []),
    )
    .map((role) => role.id)
  if (candidateRoleIds.length === 0) return

  const members = await roleRepository.activeMemberships(clinicId, candidateRoleIds)
  const before = administratorRemains({
    roles: new Map(change.roles.map((role) => [role.id, role.permissions])),
    activeUsers: members,
  })
  if (!before) return

  const after = administratorRemains({
    roles: new Map(change.roles.map((role) => [role.id, next.get(role.id) ?? role.permissions])),
    activeUsers: change.applyToMembers ? change.applyToMembers(members) : members,
  })
  if (!after) {
    throw new BusinessRuleError(
      'LAST_ADMINISTRATOR',
      'This change would leave no active user who can manage roles.',
    )
  }
}
