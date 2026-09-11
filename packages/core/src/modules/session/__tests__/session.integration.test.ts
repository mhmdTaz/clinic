import { describe, expect, it } from 'vitest'
import { env } from '@clinic/config'
import { AuditLogModel, ClinicModel, RoleModel, UserModel, newId } from '@clinic/db'
import {
  NEW_PASSWORD,
  TEST_PASSWORD,
  createUser,
  meta,
  outcome,
  secondsAfter,
} from '../../../../test/fixtures'
import { assertCan } from '../../access'
import { flushAudit } from '../../audit'
import { issueInvitation } from '../../identity'
import { generateOpaqueToken, hashOpaqueToken } from '../../identity/domain/tokens'
import { passwordResetRepository } from '../../identity/infrastructure/password-reset.repository'
import {
  acceptInvitation,
  authenticateAccessToken,
  changeMyPassword,
  forgotPassword,
  login,
  logout,
  previewActivation,
  refresh,
  resetForgottenPassword,
} from '../index'

async function auditEntries(action: string, entityId?: string) {
  await flushAudit()
  return AuditLogModel()
    .find({ clinicId: env().CLINIC_ID, action, ...(entityId ? { 'entity.id': entityId } : {}) })
    .sort({ occurredAt: -1 })
    .lean()
}

describe('login', () => {
  it('signs an active user in and lands them on their own portal', async () => {
    const user = await createUser({ role: 'staff' })
    const session = await login({ email: user.email, password: TEST_PASSWORD, meta: meta() })

    expect(session.user.landingPath).toBe('/staff')
    expect(session.user.portals).toEqual(['staff'])
    expect(session.accessToken).toBeTruthy()
    expect(session.refreshToken).toHaveLength(43)

    const [entry] = await auditEntries('auth.login', user.id)
    expect(entry?.actor).toMatchObject({ id: user.id, type: 'USER', roles: ['staff'] })
  })

  it('matches the email case-insensitively', async () => {
    const user = await createUser()
    const session = await login({
      email: user.email.toUpperCase(),
      password: TEST_PASSWORD,
      meta: meta(),
    })
    expect(session.user.id).toBe(user.id)
  })

  it('answers identically for an unknown email and a wrong password', async () => {
    const user = await createUser()
    expect(
      await outcome(login({ email: user.email, password: 'wrong-password-123', meta: meta() })),
    ).toBe('INVALID_CREDENTIALS')
    expect(
      await outcome(
        login({ email: 'nobody-here@itest.local', password: TEST_PASSWORD, meta: meta() }),
      ),
    ).toBe('INVALID_CREDENTIALS')

    const [failure] = await auditEntries('auth.login_failed', user.id)
    expect(failure?.outcome).toBe('FAILURE')
    expect(failure?.metadata).toMatchObject({ reason: 'wrong_password', consecutiveFailures: 1 })
  })

  it('locks after repeated failures, and even the right password cannot get past the lock', async () => {
    const user = await createUser()
    const t0 = new Date()
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      expect(
        await outcome(
          login({ email: user.email, password: `wrong-${attempt}-attempt`, meta: meta() }, t0),
        ),
      ).toBe('INVALID_CREDENTIALS')
    }

    expect(
      await outcome(login({ email: user.email, password: TEST_PASSWORD, meta: meta() }, t0)),
    ).toBe('TOO_MANY_ATTEMPTS')
    // The fifth failure locks for 30 seconds; after that the right password works again.
    expect(
      await outcome(
        login({ email: user.email, password: TEST_PASSWORD, meta: meta() }, secondsAfter(t0, 31)),
      ),
    ).toBe('RESOLVED')
  })

  it('refuses a suspended account, and says so only after the right password', async () => {
    const user = await createUser({ status: 'SUSPENDED' })
    expect(
      await outcome(login({ email: user.email, password: 'wrong-password-123', meta: meta() })),
    ).toBe('INVALID_CREDENTIALS')
    expect(await outcome(login({ email: user.email, password: TEST_PASSWORD, meta: meta() }))).toBe(
      'ACCOUNT_DISABLED',
    )
  })

  it('refuses an invited account that has not chosen a password yet', async () => {
    const user = await createUser({ status: 'INVITED', password: null })
    expect(await outcome(login({ email: user.email, password: TEST_PASSWORD, meta: meta() }))).toBe(
      'INVALID_CREDENTIALS',
    )
  })
})

describe('authenticateAccessToken', () => {
  it('resolves the actor from a fresh token', async () => {
    const user = await createUser({ role: 'patient' })
    const session = await login({ email: user.email, password: TEST_PASSWORD, meta: meta() })
    const { actor, reissued } = await authenticateAccessToken(session.accessToken)

    expect(reissued).toBeNull()
    expect(actor.userId).toBe(user.id)
    expect(actor.sessionId).toBe(session.sessionId)
    expect(actor.permissions.get('patient:read')).toBe('OWN')
  })

  it('rejects the token on the very next request after sign-out', async () => {
    const user = await createUser()
    const session = await login({ email: user.email, password: TEST_PASSWORD, meta: meta() })
    await logout({ refreshToken: session.refreshToken })
    expect(await outcome(authenticateAccessToken(session.accessToken))).toBe('UNAUTHENTICATED')
  })

  it('rejects the token of a user suspended mid-session', async () => {
    const user = await createUser()
    const session = await login({ email: user.email, password: TEST_PASSWORD, meta: meta() })
    await UserModel().updateOne(
      { clinicId: env().CLINIC_ID, _id: user.id },
      { $set: { status: 'SUSPENDED' } },
    )
    expect(await outcome(authenticateAccessToken(session.accessToken))).toBe('UNAUTHENTICATED')
  })

  it('applies changed grants on the next request and hands back a replacement token', async () => {
    const clinicId = env().CLINIC_ID
    const role = await RoleModel().create({
      _id: newId(),
      clinicId,
      key: `front-desk-${newId()}`,
      name: 'Front desk (test)',
      permissions: [{ key: 'portal.staff:access', scope: 'CLINIC' }],
    })
    const user = await createUser({ roleId: role._id })
    const session = await login({ email: user.email, password: TEST_PASSWORD, meta: meta() })
    expect(
      (await authenticateAccessToken(session.accessToken)).actor.permissions.has('clinic:read'),
    ).toBe(false)

    await RoleModel().updateOne(
      { clinicId, _id: role._id },
      { $push: { permissions: { key: 'clinic:read', scope: 'CLINIC' } } },
    )
    await ClinicModel().updateOne({ _id: clinicId }, { $inc: { permissionVersion: 1 } })

    const stale = await authenticateAccessToken(session.accessToken)
    expect(stale.actor.permissions.has('clinic:read')).toBe(true)
    expect(stale.reissued).not.toBeNull()

    const fresh = await authenticateAccessToken(stale.reissued?.token ?? '')
    expect(fresh.reissued).toBeNull()
    expect(fresh.actor.permissions.has('clinic:read')).toBe(true)
  })
})

describe('refresh', () => {
  it('rotates the refresh token', async () => {
    const user = await createUser()
    const session = await login({ email: user.email, password: TEST_PASSWORD, meta: meta() })
    const rotated = await refresh({ refreshToken: session.refreshToken, meta: meta() })

    expect(rotated.refreshToken).not.toBe(session.refreshToken)
    expect(rotated.sessionId).toBe(session.sessionId)
    expect((await authenticateAccessToken(rotated.accessToken)).actor.userId).toBe(user.id)
  })

  it('tolerates the same token twice within the grace window — two tabs refreshing at once', async () => {
    const user = await createUser()
    const session = await login({ email: user.email, password: TEST_PASSWORD, meta: meta() })
    const t0 = new Date()
    await refresh({ refreshToken: session.refreshToken, meta: meta() }, t0)
    expect(
      await outcome(
        refresh({ refreshToken: session.refreshToken, meta: meta() }, secondsAfter(t0, 5)),
      ),
    ).toBe('RESOLVED')
  })

  it('treats reuse after the grace window as theft and ends the whole session', async () => {
    const user = await createUser()
    const session = await login({ email: user.email, password: TEST_PASSWORD, meta: meta() })
    const t0 = new Date()
    const legitimate = await refresh({ refreshToken: session.refreshToken, meta: meta() }, t0)

    expect(
      await outcome(
        refresh({ refreshToken: session.refreshToken, meta: meta() }, secondsAfter(t0, 20)),
      ),
    ).toBe('UNAUTHENTICATED')
    // The real user's newer token dies with the stolen one.
    expect(
      await outcome(
        refresh({ refreshToken: legitimate.refreshToken, meta: meta() }, secondsAfter(t0, 21)),
      ),
    ).toBe('UNAUTHENTICATED')
    expect(await outcome(authenticateAccessToken(legitimate.accessToken))).toBe('UNAUTHENTICATED')

    const [alarm] = await auditEntries('auth.refresh_token_reused', user.id)
    expect(alarm?.severity).toBe('CRITICAL')
  })
})

describe('passwords', () => {
  it('signs out other devices when a password changes, but keeps this one', async () => {
    const user = await createUser()
    const here = await login({ email: user.email, password: TEST_PASSWORD, meta: meta() })
    const elsewhere = await login({ email: user.email, password: TEST_PASSWORD, meta: meta() })
    const { actor } = await authenticateAccessToken(here.accessToken)

    const replacement = await changeMyPassword(actor, {
      currentPassword: TEST_PASSWORD,
      newPassword: NEW_PASSWORD,
    })

    expect((await authenticateAccessToken(replacement.token)).actor.userId).toBe(user.id)
    expect(await outcome(authenticateAccessToken(here.accessToken))).toBe('UNAUTHENTICATED')
    expect(await outcome(authenticateAccessToken(elsewhere.accessToken))).toBe('UNAUTHENTICATED')
    expect(await outcome(login({ email: user.email, password: TEST_PASSWORD, meta: meta() }))).toBe(
      'INVALID_CREDENTIALS',
    )
    expect(await outcome(login({ email: user.email, password: NEW_PASSWORD, meta: meta() }))).toBe(
      'RESOLVED',
    )
  })

  it('refuses a wrong current password, and a new password equal to the current one', async () => {
    const user = await createUser()
    const session = await login({ email: user.email, password: TEST_PASSWORD, meta: meta() })
    const { actor } = await authenticateAccessToken(session.accessToken)

    expect(
      await outcome(
        changeMyPassword(actor, { currentPassword: 'not-my-password', newPassword: NEW_PASSWORD }),
      ),
    ).toBe('CURRENT_PASSWORD_INCORRECT')
    expect(
      await outcome(
        changeMyPassword(actor, { currentPassword: TEST_PASSWORD, newPassword: TEST_PASSWORD }),
      ),
    ).toBe('PASSWORD_POLICY')
  })

  it('reports a weak new password against newPassword, the field the form shows it beside', async () => {
    const user = await createUser()
    const session = await login({ email: user.email, password: TEST_PASSWORD, meta: meta() })
    const { actor } = await authenticateAccessToken(session.accessToken)

    const rejection = await changeMyPassword(actor, {
      currentPassword: TEST_PASSWORD,
      newPassword: 'Password2026!!',
    }).catch((error: unknown) => error)

    const { code, details } = rejection as {
      code?: string
      details?: Array<{ field: string; issue: string }>
    }
    expect(code).toBe('PASSWORD_POLICY')
    expect(details).toContainEqual({ field: 'newPassword', issue: 'TOO_COMMON' })
    expect(details?.every((detail) => detail.field === 'newPassword')).toBe(true)
  })

  it('resets a forgotten password exactly once and ends every session', async () => {
    const user = await createUser()
    const session = await login({ email: user.email, password: TEST_PASSWORD, meta: meta() })
    const now = new Date()
    const token = generateOpaqueToken()
    await passwordResetRepository.create(
      {
        id: newId(),
        clinicId: env().CLINIC_ID,
        userId: user.id,
        tokenHash: await hashOpaqueToken(token),
        requestedIp: null,
        expiresAt: secondsAfter(now, 1800),
      },
      now,
    )

    // A rejected password does not burn the link.
    expect(await outcome(resetForgottenPassword({ token, password: 'short', meta: meta() }))).toBe(
      'PASSWORD_POLICY',
    )
    expect(
      await outcome(resetForgottenPassword({ token, password: NEW_PASSWORD, meta: meta() })),
    ).toBe('RESOLVED')

    expect(
      await outcome(resetForgottenPassword({ token, password: NEW_PASSWORD, meta: meta() })),
    ).toBe('INVALID_OR_EXPIRED_LINK')
    expect(await outcome(authenticateAccessToken(session.accessToken))).toBe('UNAUTHENTICATED')
    expect(await outcome(login({ email: user.email, password: NEW_PASSWORD, meta: meta() }))).toBe(
      'RESOLVED',
    )
  })

  it('answers a forgot-password request for an unknown address exactly like a known one', async () => {
    expect(
      await outcome(forgotPassword({ email: 'nobody-at-all@itest.local', meta: meta() })),
    ).toBe('RESOLVED')
    const known = await createUser()
    expect(await outcome(forgotPassword({ email: known.email, meta: meta() }))).toBe('RESOLVED')
  })
})

describe('invitations', () => {
  it('activates an invited account once and signs the user straight in', async () => {
    const user = await createUser({ status: 'INVITED', password: null })
    const { link } = await issueInvitation({
      clinicId: env().CLINIC_ID,
      userId: user.id,
      invitedBy: { id: 'system', name: 'Integration' },
      appUrl: env().APP_URL,
      clinicName: 'Integration Clinic',
    })
    const token = new URLSearchParams(new URL(link).hash.slice(1)).get('token') ?? ''
    expect(new URL(link).search).toBe('') // never in the query string

    const preview = await previewActivation({ token, meta: meta() })
    expect(preview).toMatchObject({
      email: user.email,
      firstName: 'Maya',
      clinicName: 'Integration Clinic',
    })

    const session = await acceptInvitation({ token, password: NEW_PASSWORD, meta: meta() })
    expect(session.user.status).toBe('ACTIVE')
    expect(session.user.landingPath).toBe('/patient')

    expect(await outcome(acceptInvitation({ token, password: NEW_PASSWORD, meta: meta() }))).toBe(
      'INVALID_OR_EXPIRED_LINK',
    )
  })
})

describe('permission denials', () => {
  it('records permission.denied in the audit log before refusing', async () => {
    const user = await createUser({ role: 'patient' })
    const session = await login({ email: user.email, password: TEST_PASSWORD, meta: meta() })
    const { actor } = await authenticateAccessToken(session.accessToken)

    expect(await outcome(assertCan(actor, 'audit:read'))).toBe('FORBIDDEN')

    await flushAudit()
    const denial = await AuditLogModel()
      .findOne({
        clinicId: env().CLINIC_ID,
        action: 'permission.denied',
        'actor.id': user.id,
        'metadata.permission': 'audit:read',
      })
      .lean()
    expect(denial).toMatchObject({
      outcome: 'DENIED',
      severity: 'WARNING',
      category: 'ACCESS_CONTROL',
    })
    expect(denial?.expiresAt.getUTCFullYear()).toBe((denial?.occurredAt.getUTCFullYear() ?? 0) + 7)
  })
})
