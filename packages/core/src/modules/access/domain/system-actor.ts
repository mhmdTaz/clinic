import { PERMISSION_KEYS, type PermissionKey } from './permissions.catalog'
import type { Actor } from './policy'
import type { Scope } from './scopes'

export const SYSTEM_ACTOR_ID = 'system'

/**
 * The actor background jobs, the seed and migrations run as. It holds every
 * permission at GLOBAL scope, and every action it takes is still audited with
 * actor type SYSTEM — "who did this" is never blank.
 */
export function systemActor(clinicId: string, label = 'system'): Actor {
  return {
    kind: 'SYSTEM',
    userId: SYSTEM_ACTOR_ID,
    clinicId,
    displayName: label,
    roleKeys: [],
    permissions: new Map(PERMISSION_KEYS.map((key): [PermissionKey, Scope] => [key, 'GLOBAL'])),
    portals: [],
    preferredPortal: null,
    sessionId: null,
  }
}
