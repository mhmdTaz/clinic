import type { PortalKey } from '@clinic/config'
import type { AuthUser } from '../domain/types'
import { userRepository } from '../infrastructure/user.repository'

export function findUser(clinicId: string, userId: string): Promise<AuthUser | null> {
  return userRepository.findById(clinicId, userId)
}

/**
 * Self-service profile fields only. Status, roles and email belong to user management,
 * which checks its own permissions in Phase 2.
 */
export function updateProfile(
  clinicId: string,
  userId: string,
  patch: {
    firstName?: string
    lastName?: string
    phone?: string | null
    preferredPortal?: PortalKey
  },
): Promise<AuthUser | null> {
  return userRepository.updateProfile(clinicId, userId, patch)
}
