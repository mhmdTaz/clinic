import { ForbiddenError } from '../../../errors'
import { recordAudit } from '../../audit'
import type { PermissionKey } from '../domain/permissions.catalog'
import { decide, type Actor, type ScopedResource } from '../domain/policy'

/**
 * The throwing form of can(), and the default in use cases (section 7.5): a forgotten
 * `if` cannot become a silent allow.
 *
 * Every denial is recorded with outcome DENIED before the error is thrown. Someone
 * repeatedly probing endpoints they cannot reach is exactly the signal an audit log
 * exists to surface, and it is invisible if only successes are kept (section 11.4).
 */
export async function assertCan(
  actor: Actor,
  permission: PermissionKey,
  resource?: ScopedResource,
): Promise<void> {
  const decision = await decide(actor, permission, resource)
  if (decision.allowed) return

  await recordAudit({
    action: 'permission.denied',
    category: 'ACCESS_CONTROL',
    severity: 'WARNING',
    outcome: 'DENIED',
    clinicId: actor.clinicId,
    actor: {
      id: actor.userId,
      type: actor.kind,
      label: actor.displayName,
      roles: actor.roleKeys,
    },
    entity: resource
      ? {
          type: typeof resource.type === 'string' ? resource.type : 'resource',
          id: typeof resource.id === 'string' ? resource.id : null,
        }
      : undefined,
    metadata: { permission, reason: decision.reason },
  })

  throw new ForbiddenError(permission)
}
