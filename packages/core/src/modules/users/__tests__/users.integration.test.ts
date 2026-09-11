import { describe, expect, it } from 'vitest'
import { newId } from '@clinic/db'
import {
  TEST_PASSWORD,
  createUser,
  meta,
  outcome,
  roleIdOf,
  signedInActor,
  uniqueEmail,
} from '../../../../test/fixtures'
import { authenticateAccessToken, login } from '../../session'
import {
  changeUserStatus,
  forceUserPasswordReset,
  inviteUser,
  listUsers,
  setUserRoles,
  updateUser,
} from '../index'

describe('inviting a user', () => {
  it('creates an account waiting for activation, with its roles and the link on its way', async () => {
    const { actor: admin } = await signedInActor({ role: 'admin' })
    const { user, invitationSent } = await inviteUser(admin, {
      firstName: 'Hana',
      lastName: 'Aoun',
      email: uniqueEmail('invitee'),
      phone: null,
      roleIds: [await roleIdOf('staff')],
    })

    expect(user).toMatchObject({ status: 'INVITED', hasPassword: false, roles: [{ key: 'staff' }] })
    expect(user.invitation).not.toBeNull()
    expect(invitationSent).toBe(true)
  })

  it('refuses an address another account already uses, whatever its case', async () => {
    const { actor: admin } = await signedInActor({ role: 'admin' })
    const existing = await createUser({ role: 'staff' })
    expect(
      await outcome(
        inviteUser(admin, {
          firstName: 'Hana',
          lastName: 'Aoun',
          email: existing.email.toUpperCase(),
          phone: null,
          roleIds: [await roleIdOf('staff')],
        }),
      ),
    ).toBe('EMAIL_TAKEN')
  })
})

describe('guarding against yourself', () => {
  it('lets nobody change their own roles or status, or force their own reset', async () => {
    const { actor: admin } = await signedInActor({ role: 'admin' })
    expect(await outcome(setUserRoles(admin, admin.userId, { roleIds: [] }))).toBe(
      'CANNOT_CHANGE_OWN_ROLES',
    )
    expect(
      await outcome(changeUserStatus(admin, admin.userId, { action: 'suspend', reason: null })),
    ).toBe('CANNOT_CHANGE_OWN_STATUS')
    expect(await outcome(forceUserPasswordReset(admin, admin.userId))).toBe(
      'CANNOT_RESET_OWN_PASSWORD',
    )
  })

  it('lets staff hand out no role at all', async () => {
    const { actor: staff } = await signedInActor({ role: 'staff' })
    const colleague = await createUser({ role: 'staff' })
    expect(
      await outcome(setUserRoles(staff, colleague.id, { roleIds: [await roleIdOf('admin')] })),
    ).toBe('FORBIDDEN')
  })
})

describe('suspension', () => {
  it('ends access on the very next request, and restoring gives it back', async () => {
    const { actor: admin } = await signedInActor({ role: 'admin' })
    const staff = await createUser({ role: 'staff' })
    const session = await login({ email: staff.email, password: TEST_PASSWORD, meta: meta() })

    const suspended = await changeUserStatus(admin, staff.id, {
      action: 'suspend',
      reason: 'Left the clinic',
    })
    expect(suspended.status).toBe('SUSPENDED')
    expect(await outcome(authenticateAccessToken(session.accessToken))).toBe('UNAUTHENTICATED')

    const restored = await changeUserStatus(admin, staff.id, { action: 'restore', reason: null })
    expect(restored.status).toBe('ACTIVE')
    expect(
      await outcome(login({ email: staff.email, password: TEST_PASSWORD, meta: meta() })),
    ).toBe('RESOLVED')
  })

  it('returns an account that never activated to waiting for activation', async () => {
    const { actor: admin } = await signedInActor({ role: 'admin' })
    const invited = await createUser({ status: 'INVITED', password: null })
    await changeUserStatus(admin, invited.id, { action: 'suspend', reason: null })
    const restored = await changeUserStatus(admin, invited.id, { action: 'restore', reason: null })
    expect(restored.status).toBe('INVITED')
  })
})

describe('forced password reset', () => {
  it('stops the old password at once and signs the user out everywhere', async () => {
    const { actor: admin } = await signedInActor({ role: 'admin' })
    const staff = await createUser({ role: 'staff' })
    const session = await login({ email: staff.email, password: TEST_PASSWORD, meta: meta() })

    const detail = await forceUserPasswordReset(admin, staff.id)

    expect(detail.hasPassword).toBe(false)
    expect(await outcome(authenticateAccessToken(session.accessToken))).toBe('UNAUTHENTICATED')
    expect(
      await outcome(login({ email: staff.email, password: TEST_PASSWORD, meta: meta() })),
    ).toBe('INVALID_CREDENTIALS')
  })
})

describe('editing an account', () => {
  it('moves the address of an account waiting for activation, and sends the new address a link', async () => {
    const { actor: admin } = await signedInActor({ role: 'admin' })
    const invited = await createUser({ status: 'INVITED', password: null })
    const email = uniqueEmail('moved')

    const { user, invitationSent } = await updateUser(admin, invited.id, {
      firstName: 'Maya',
      lastName: 'Haddad',
      phone: null,
      email,
    })
    expect(user.email).toBe(email)
    expect(invitationSent).toBe(true)
  })

  it('keeps the address of an activated account — it is how they sign in', async () => {
    const { actor: admin } = await signedInActor({ role: 'admin' })
    const active = await createUser({ role: 'staff' })
    expect(
      await outcome(
        updateUser(admin, active.id, {
          firstName: 'Maya',
          lastName: 'Haddad',
          phone: '+961 3 000 000',
          email: uniqueEmail('elsewhere'),
        }),
      ),
    ).toBe('EMAIL_LOCKED')
  })
})

describe('the directory', () => {
  it('finds people by a folded name, a page at a time, in name order', async () => {
    const { actor: admin } = await signedInActor({ role: 'admin' })
    const suffix = newId().slice(0, 8)
    for (const firstName of ['Carla', 'Amal', 'Bilal']) {
      await createUser({ role: 'staff', firstName, lastName: `Zébulon${suffix}` })
    }

    const q = `zebulon${suffix}`
    const first = await listUsers(admin, { q, limit: 2 })
    expect(first.items.map((user) => user.firstName)).toEqual(['Amal', 'Bilal'])
    expect(first.nextCursor).not.toBeNull()

    const second = await listUsers(admin, { q, limit: 2, cursor: first.nextCursor ?? undefined })
    expect(second.items.map((user) => user.firstName)).toEqual(['Carla'])
    expect(second.nextCursor).toBeNull()
  })

  it('shows someone who may read only their own account just that account', async () => {
    const { actor: patient } = await signedInActor({ role: 'patient' })
    const page = await listUsers(patient, { limit: 25 })
    expect(page.items.map((user) => user.id)).toEqual([patient.userId])
  })
})
