import type { PermissionKey } from '../domain/permissions.catalog'
import { roleRepository } from '../infrastructure/role.repository'

/**
 * Everyone in the clinic who holds a permission (section 7.2).
 *
 * The worker needs this to answer "who should hear about a new ticket", and the answer has to be
 * **a permission rather than a role name**: a clinic that invents a "Reception lead" role and
 * gives it `ticket:manage` gets the notification without anybody editing a handler. Asking for
 * the role would have hard-coded today's org chart into tomorrow's code.
 *
 * No permission check of its own — it is a lookup a background job performs on nobody's behalf,
 * and it returns ids rather than people, so there is nothing here to leak.
 */
export async function usersHolding(clinicId: string, permission: PermissionKey): Promise<string[]> {
  const roles = await roleRepository.listAll(clinicId)
  const granting = roles
    .filter((role) => role.permissions.some((entry) => entry.key === permission))
    .map((role) => role.id)

  const members = await roleRepository.activeMemberships(clinicId, granting)
  return [...new Set(members.map((member) => member.id))]
}
