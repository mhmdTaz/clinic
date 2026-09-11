import { env } from '@clinic/config'
import type {
  ChangeUserStatusRequest,
  InviteUserRequest,
  SetUserRolesRequest,
  UpdateUserRequest,
  UserDetail,
} from '@clinic/contracts'
import { BusinessRuleError, NotFoundError } from '../../../errors'
import { runInTransaction } from '../../../transaction'
import { recordAudit } from '../../audit'
import {
  assertAdministratorRemainsWithout,
  assertCan,
  authorizeRoleAssignment,
  bumpPermissionVersion,
  type Actor,
} from '../../access'
import { getClinicSessionInfo } from '../../clinic'
import {
  createAccount,
  findUser,
  forcePasswordReset,
  issueInvitation,
  setAccountRoles,
  setAccountStatus,
  tryIssueInvitation,
  updateAccountDetails,
} from '../../identity'
import { restoredStatus } from '../domain/status'
import { getUser } from './directory'

/** User management (A3). Every change is permission-checked here and recorded with its intent. */

const userResource = (actor: Actor, userId: string) => ({
  clinicId: actor.clinicId,
  type: 'User',
  id: userId,
})

async function invitationInput(actor: Actor, userId: string) {
  const clinic = await getClinicSessionInfo(actor.clinicId)
  return {
    clinicId: actor.clinicId,
    userId,
    invitedBy: { id: actor.userId, name: actor.displayName },
    appUrl: env().APP_URL,
    clinicName: clinic.name,
  }
}

/** Creates the account with its roles and emails the activation link (ADR-0006). */
export async function inviteUser(
  actor: Actor,
  input: InviteUserRequest,
  now: Date = new Date(),
): Promise<{ user: UserDetail; invitationSent: boolean }> {
  await assertCan(actor, 'user:invite')
  const change = await authorizeRoleAssignment(actor, {
    userId: '',
    userStatus: 'INVITED',
    currentRoleIds: [],
    nextRoleIds: input.roleIds,
  })

  const account = await createAccount(
    {
      clinicId: actor.clinicId,
      email: input.email,
      firstName: input.firstName,
      lastName: input.lastName,
      phone: input.phone,
      roleIds: change.roles.map((role) => role.id),
      assignedBy: actor.userId,
    },
    now,
  )
  await recordAudit({
    action: 'user.role_assigned',
    category: 'ACCESS_CONTROL',
    severity: 'NOTICE',
    clinicId: actor.clinicId,
    entity: { type: 'User', id: account.id, label: account.email },
    metadata: { roles: change.added },
  })

  const invitationSent = await tryIssueInvitation(await invitationInput(actor, account.id), now)
  return { user: await getUser(actor, account.id, now), invitationSent }
}

/**
 * Name and phone at any time; the email only before activation. A new address gets a new
 * activation link, since the old one went to the old address.
 */
export async function updateUser(
  actor: Actor,
  userId: string,
  input: UpdateUserRequest,
  now: Date = new Date(),
): Promise<{ user: UserDetail; invitationSent: boolean | null }> {
  await assertCan(actor, 'user:update', userResource(actor, userId))
  const { emailChanged } = await updateAccountDetails(actor.clinicId, userId, input, now)
  const invitationSent = emailChanged
    ? await tryIssueInvitation(await invitationInput(actor, userId), now)
    : null
  return { user: await getUser(actor, userId, now), invitationSent }
}

/**
 * Suspension ends every session on the user's next request. Nobody changes their own status,
 * and the last administrator cannot be suspended.
 */
export async function changeUserStatus(
  actor: Actor,
  userId: string,
  input: ChangeUserStatusRequest,
  now: Date = new Date(),
): Promise<UserDetail> {
  await assertCan(actor, 'user:suspend', userResource(actor, userId))
  if (userId === actor.userId) {
    throw new BusinessRuleError(
      'CANNOT_CHANGE_OWN_STATUS',
      'Ask another administrator to change your account status.',
    )
  }
  const user = await findUser(actor.clinicId, userId)
  if (!user) throw new NotFoundError('User')

  if (input.action === 'suspend' && user.status !== 'SUSPENDED') {
    if (user.status === 'ACTIVE') await assertAdministratorRemainsWithout(actor.clinicId, userId)
    await setAccountStatus(actor.clinicId, userId, 'SUSPENDED', now)
    await recordAudit({
      action: 'user.suspended',
      category: 'ACCESS_CONTROL',
      severity: 'WARNING',
      clinicId: actor.clinicId,
      entity: { type: 'User', id: userId, label: user.email },
      metadata: { reason: input.reason, previousStatus: user.status },
    })
  }

  if (input.action === 'restore' && user.status === 'SUSPENDED') {
    const status = restoredStatus(user)
    await setAccountStatus(actor.clinicId, userId, status, now)
    await recordAudit({
      action: 'user.restored',
      category: 'ACCESS_CONTROL',
      severity: 'NOTICE',
      clinicId: actor.clinicId,
      entity: { type: 'User', id: userId, label: user.email },
      metadata: { reason: input.reason, status },
    })
  }

  return getUser(actor, userId, now)
}

/**
 * Replaces a user's roles. The roles and the permission version change in one transaction, so
 * the user's next request — on any device — runs with exactly the new access (section 7.7).
 */
export async function setUserRoles(
  actor: Actor,
  userId: string,
  input: SetUserRolesRequest,
  now: Date = new Date(),
): Promise<UserDetail> {
  // Checked before the user is loaded, so someone who may not assign roles learns nothing.
  await assertCan(actor, 'role:assign', userResource(actor, userId))
  const user = await findUser(actor.clinicId, userId)
  if (!user) throw new NotFoundError('User')

  const change = await authorizeRoleAssignment(actor, {
    userId,
    userStatus: user.status,
    currentRoleIds: user.roleIds,
    nextRoleIds: input.roleIds,
  })
  if (change.added.length === 0 && change.removed.length === 0) {
    return getUser(actor, userId, now)
  }

  await runInTransaction(async (tx) => {
    await setAccountRoles(
      actor.clinicId,
      userId,
      change.roles.map((role) => role.id),
      { assignedBy: actor.userId, now },
      tx,
    )
    await bumpPermissionVersion(actor.clinicId, tx)
  })

  const entity = { type: 'User', id: userId, label: user.email }
  if (change.added.length > 0) {
    await recordAudit({
      action: 'user.role_assigned',
      category: 'ACCESS_CONTROL',
      severity: 'NOTICE',
      clinicId: actor.clinicId,
      entity,
      metadata: { roles: change.added },
    })
  }
  if (change.removed.length > 0) {
    await recordAudit({
      action: 'user.role_revoked',
      category: 'ACCESS_CONTROL',
      severity: 'NOTICE',
      clinicId: actor.clinicId,
      entity,
      metadata: { roles: change.removed },
    })
  }

  return getUser(actor, userId, now)
}

/** An explicit resend: a mail failure is reported to the person who asked for it. */
export async function resendInvitation(
  actor: Actor,
  userId: string,
  now: Date = new Date(),
): Promise<UserDetail> {
  await assertCan(actor, 'user:invite')
  await issueInvitation(await invitationInput(actor, userId), now)
  return getUser(actor, userId, now)
}

export async function forceUserPasswordReset(
  actor: Actor,
  userId: string,
  now: Date = new Date(),
): Promise<UserDetail> {
  await assertCan(actor, 'user:reset_password', userResource(actor, userId))
  if (userId === actor.userId) {
    throw new BusinessRuleError(
      'CANNOT_RESET_OWN_PASSWORD',
      'Change your own password from Profile & security.',
    )
  }
  const clinic = await getClinicSessionInfo(actor.clinicId)
  const { expiresAt } = await forcePasswordReset(
    { clinicId: actor.clinicId, userId, appUrl: env().APP_URL, clinicName: clinic.name },
    now,
  )
  await recordAudit({
    action: 'user.password_reset_forced',
    category: 'AUTH',
    severity: 'WARNING',
    clinicId: actor.clinicId,
    entity: { type: 'User', id: userId },
    metadata: { linkExpiresAt: expiresAt.toISOString() },
  })
  return getUser(actor, userId, now)
}
