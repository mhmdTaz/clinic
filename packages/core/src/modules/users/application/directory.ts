import type { RoleRef, UserDetail, UserListQuery, UserSummary } from '@clinic/contracts'
import { NotFoundError } from '../../../errors'
import type { Page } from '../../../pagination'
import { assertCan, roleDirectory, scopeAtLeast, type Actor } from '../../access'
import {
  displayNameOf,
  findAccounts,
  findUser,
  latestInvitation,
  listAccounts,
  type AuthUser,
} from '../../identity'

export function toUserSummary(user: AuthUser, roles: ReadonlyMap<string, RoleRef>): UserSummary {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    displayName: displayNameOf(user),
    phone: user.phone,
    status: user.status,
    roles: user.roleIds
      .map((roleId) => roles.get(roleId))
      .filter((role): role is RoleRef => role !== undefined),
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    createdAt: user.createdAt?.toISOString() ?? null,
  }
}

/**
 * The user directory. Someone who may read only their own account (user:read at OWN) is shown
 * that one account rather than refused: a list applies its scope as a filter (section 7.5).
 */
export async function listUsers(actor: Actor, query: UserListQuery): Promise<Page<UserSummary>> {
  await assertCan(actor, 'user:read')
  const roles = await roleDirectory(actor.clinicId)

  const scope = actor.permissions.get('user:read')
  if (!scope || !scopeAtLeast(scope, 'CLINIC')) {
    const [self] = await findAccounts(actor.clinicId, [actor.userId])
    return { items: self ? [toUserSummary(self, roles)] : [], nextCursor: null }
  }

  const page = await listAccounts(actor.clinicId, {
    q: query.q,
    status: query.status,
    roleId: query.roleId,
    limit: query.limit,
    cursor: query.cursor,
  })
  return {
    items: page.items.map((user) => toUserSummary(user, roles)),
    nextCursor: page.nextCursor,
  }
}

export async function getUser(
  actor: Actor,
  userId: string,
  now: Date = new Date(),
): Promise<UserDetail> {
  await assertCan(actor, 'user:read', { clinicId: actor.clinicId, type: 'User', id: userId })
  const user = await findUser(actor.clinicId, userId)
  if (!user) throw new NotFoundError('User')

  const [roles, invitation] = await Promise.all([
    roleDirectory(actor.clinicId),
    user.status === 'INVITED' ? latestInvitation(actor.clinicId, user.id, now) : null,
  ])

  return {
    ...toUserSummary(user, roles),
    invitation: invitation
      ? { sentAt: invitation.sentAt.toISOString(), expiresAt: invitation.expiresAt.toISOString() }
      : null,
    hasPassword: user.passwordHash !== null,
    isSelf: user.id === actor.userId,
  }
}
