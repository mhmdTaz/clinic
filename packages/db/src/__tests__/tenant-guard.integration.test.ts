import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { connect, disconnect, newId } from '../index'
import { UserModel } from '../models/index'
import { MissingTenantFilterError } from '../errors'

/**
 * Phase 0 exit criterion: "a query missing clinicId throws".
 * Requires the local stack: pnpm infra:up && pnpm db:migrate
 */
describe('tenant guard (live)', () => {
  const clinicId = `test_${newId()}`

  beforeAll(async () => {
    await connect()
  })
  afterAll(async () => {
    await UserModel().deleteMany({ clinicId })
    await disconnect()
  })

  it('throws when a find omits clinicId', async () => {
    await expect(UserModel().find({ status: 'ACTIVE' }).exec()).rejects.toThrow(
      MissingTenantFilterError,
    )
  })

  it('throws when an update omits clinicId', async () => {
    await expect(
      UserModel().updateOne({ _id: 'anything' }, { $set: { phone: '1' } }),
    ).rejects.toThrow(/clinicId/)
  })

  it('allows a scoped query', async () => {
    await expect(UserModel().find({ clinicId }).exec()).resolves.toEqual([])
  })

  it('allows an explicit, grep-able opt-out', async () => {
    await expect(
      UserModel().find({}).setOptions({ bypassTenantGuard: true }).limit(1).exec(),
    ).resolves.toBeInstanceOf(Array)
  })

  it('refuses to save a document with no clinicId', async () => {
    const user = new (UserModel())({ email: 'x@y.z', firstName: 'A', lastName: 'B' })
    await expect(user.save()).rejects.toThrow(/clinicId/)
  })
})
