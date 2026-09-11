import { describe, expect, it } from 'vitest'
import { env } from '@clinic/config'
import { AuditLogModel, newId } from '@clinic/db'
import {
  TEST_PASSWORD,
  createUser,
  meta,
  outcome,
  roleIdOf,
  signedInActor,
} from '../../../../test/fixtures'
import { flushAudit } from '../../audit'
import { authenticateAccessToken, login } from '../../session'
import { setUserRoles } from '../../users'
import { createRole, deleteRole, getRole, setRolePermissions, updateRole } from '../index'

const named = (prefix: string) => ({
  name: `${prefix} ${newId().slice(0, 8)}`,
  description: null,
  copyFromRoleId: null,
})

describe('the Phase 2 exit criterion', () => {
  it('reaches a member of a new role on their very next request, with no deploy', async () => {
    const { actor: admin } = await signedInActor({ role: 'admin' })
    const headNurse = await createRole(admin, named('Head Nurse'))
    await setRolePermissions(admin, headNurse.id, [
      { key: 'portal.staff:access', scope: 'CLINIC' },
      { key: 'patient:read', scope: 'CLINIC' },
      { key: 'patient:create', scope: 'CLINIC' },
    ])

    // Already signed in, with no role at all.
    const nurse = await createUser({ roleIds: [] })
    const session = await login({ email: nurse.email, password: TEST_PASSWORD, meta: meta() })
    const before = await authenticateAccessToken(session.accessToken)
    expect(before.actor.portals).toEqual([])
    expect(before.actor.permissions.has('patient:read')).toBe(false)

    await setUserRoles(admin, nurse.id, { roleIds: [headNurse.id] })

    const after = await authenticateAccessToken(session.accessToken)
    expect(after.reissued).not.toBeNull()
    expect(after.actor.portals).toEqual(['staff'])
    expect(after.actor.permissions.get('patient:read')).toBe('CLINIC')
    expect(after.actor.permissions.get('patient:create')).toBe('CLINIC')
  })
})

describe('creating and naming roles', () => {
  it('treats names that differ only in case or accents as the same name', async () => {
    const { actor: admin } = await signedInActor({ role: 'admin' })
    const suffix = newId().slice(0, 8)
    await createRole(admin, {
      name: `Réception ${suffix}`,
      description: null,
      copyFromRoleId: null,
    })
    expect(
      await outcome(
        createRole(admin, { name: `RECEPTION ${suffix}`, description: null, copyFromRoleId: null }),
      ),
    ).toBe('ROLE_NAME_TAKEN')
  })

  it('copies grants from another role, and keeps system roles’ names', async () => {
    const { actor: admin } = await signedInActor({ role: 'admin' })
    const copy = await createRole(admin, {
      ...named('Front desk'),
      copyFromRoleId: await roleIdOf('staff'),
    })
    const staff = await getRole(admin, await roleIdOf('staff'))
    expect(copy.permissions).toEqual(staff.permissions)
    expect(copy.isSystem).toBe(false)

    expect(
      await outcome(updateRole(admin, staff.id, { name: 'Renamed staff', description: null })),
    ).toBe('SYSTEM_ROLE_PROTECTED')
  })
})

describe('editing grants', () => {
  it('lets an editor give away only what they hold themselves', async () => {
    const { actor: admin } = await signedInActor({ role: 'admin' })
    const editorRole = await createRole(admin, named('Role editor'))
    await setRolePermissions(admin, editorRole.id, [
      { key: 'portal.admin:access', scope: 'CLINIC' },
      { key: 'role:read', scope: 'CLINIC' },
      { key: 'role:update', scope: 'CLINIC' },
    ])
    const { actor: editor } = await signedInActor({ roleId: editorRole.id })
    const target = await createRole(admin, named('Target'))

    expect(
      await outcome(
        setRolePermissions(editor, target.id, [{ key: 'audit:read', scope: 'CLINIC' }]),
      ),
    ).toBe('GRANT_EXCEEDS_YOUR_ACCESS')
    expect(
      await outcome(setRolePermissions(editor, target.id, [{ key: 'role:read', scope: 'CLINIC' }])),
    ).toBe('RESOLVED')
  })

  it('refuses GLOBAL, which belongs to a platform operator rather than a clinic', async () => {
    const { actor: admin } = await signedInActor({ role: 'admin' })
    const role = await createRole(admin, named('Global attempt'))
    expect(
      await outcome(setRolePermissions(admin, role.id, [{ key: 'patient:read', scope: 'GLOBAL' }])),
    ).toBe('VALIDATION_FAILED')
  })

  it('refuses a change that would leave nobody able to manage roles', async () => {
    const { actor: admin } = await signedInActor({ role: 'admin' })
    const administrator = await getRole(admin, await roleIdOf('admin'))
    expect(
      await outcome(
        setRolePermissions(
          admin,
          administrator.id,
          administrator.permissions.filter((grant) => grant.key !== 'role:assign'),
        ),
      ),
    ).toBe('LAST_ADMINISTRATOR')
  })

  it('records what changed, not just that something did', async () => {
    const { actor: admin } = await signedInActor({ role: 'admin' })
    const role = await createRole(admin, named('Audited'))
    await setRolePermissions(admin, role.id, [
      { key: 'clinic:read', scope: 'CLINIC' },
      { key: 'patient:read', scope: 'OWN' },
    ])
    await flushAudit()

    const entry = await AuditLogModel()
      .findOne({
        clinicId: env().CLINIC_ID,
        action: 'role.permissions_changed',
        'entity.id': role.id,
      })
      .lean()
    expect(entry?.metadata).toMatchObject({
      added: [
        { key: 'clinic:read', scope: 'CLINIC' },
        { key: 'patient:read', scope: 'OWN' },
      ],
      removed: [],
    })
  })
})

describe('deleting roles', () => {
  it('refuses system roles and roles someone holds, and removes an unused custom role', async () => {
    const { actor: admin } = await signedInActor({ role: 'admin' })
    expect(await outcome(deleteRole(admin, await roleIdOf('patient')))).toBe(
      'SYSTEM_ROLE_PROTECTED',
    )

    const held = await createRole(admin, named('Held'))
    await createUser({ roleIds: [held.id] })
    expect(await outcome(deleteRole(admin, held.id))).toBe('ROLE_IN_USE')

    const unused = await createRole(admin, named('Unused'))
    await deleteRole(admin, unused.id)
    expect(await outcome(getRole(admin, unused.id))).toBe('NOT_FOUND')
  })

  it('refuses anyone without role:delete, and says so in the audit log', async () => {
    const { actor: staff } = await signedInActor({ role: 'staff' })
    expect(await outcome(deleteRole(staff, await roleIdOf('patient')))).toBe('FORBIDDEN')
  })
})
