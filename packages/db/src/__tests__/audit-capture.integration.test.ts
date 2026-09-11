import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { connect, disconnect, newId, withTransaction } from '../index'
import {
  AppointmentModel,
  AuditLogModel,
  ClinicModel,
  DoctorModel,
  InvitationModel,
  PasswordResetTokenModel,
  PatientModel,
  RefreshTokenModel,
  RoleModel,
  SlotReservationModel,
  SpecialtyModel,
  UserModel,
} from '../models/index'
import {
  AuditSinkNotConfiguredError,
  setAuditSink,
  type AuditCaptureEvent,
} from '../plugins/audit-capture'
import { REDACTED } from '../plugins/audit-diff'

/** Requires the local stack: pnpm infra:up. Runs against the dedicated test database. */
const clinicId = `c_${newId()}`
const events: AuditCaptureEvent[] = []

const newUser = () => ({
  _id: newId(),
  clinicId,
  email: `capture${newId()}@itest.local`,
  firstName: 'Maya',
  lastName: 'Haddad',
  status: 'ACTIVE',
  passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$very-secret-hash',
  deletedAt: null,
})

beforeAll(async () => {
  await connect()
})

beforeEach(() => {
  events.length = 0
  setAuditSink((event) => events.push(event))
})

afterAll(async () => {
  setAuditSink(null)
  await UserModel().deleteMany({ clinicId })
  await disconnect()
})

describe('audit capture (live)', () => {
  it('records a creation, with the password hash redacted and never present', async () => {
    const data = newUser()
    await UserModel().create(data)

    expect(events).toHaveLength(1)
    const [event] = events
    expect(event).toMatchObject({
      model: 'User',
      operation: 'created',
      entityId: data._id,
      clinicId,
    })
    expect(event?.after?.passwordHash).toBe(REDACTED)
    expect(JSON.stringify(event)).not.toContain('very-secret-hash')
  })

  it('records only the fields a query update changed', async () => {
    const data = newUser()
    await UserModel().create(data)
    events.length = 0

    await UserModel().findOneAndUpdate(
      { clinicId, _id: data._id },
      { $set: { firstName: 'Leila' } },
    )

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      operation: 'updated',
      changedPaths: ['firstName'],
      before: { firstName: 'Maya' },
      after: { firstName: 'Leila' },
    })
  })

  it('does not write the pre-image into the document it is auditing', async () => {
    const data = newUser()
    await UserModel().create(data)
    await UserModel().updateOne({ clinicId, _id: data._id }, { $set: { phone: '+961 1 111 111' } })

    const raw = await UserModel().collection.findOne({ _id: data._id as never })
    expect(Object.keys(raw ?? {}).some((key) => key.toLowerCase().includes('audit'))).toBe(false)
  })

  it('stays silent when only bookkeeping fields change', async () => {
    const data = newUser()
    await UserModel().create(data)
    events.length = 0

    await UserModel().updateOne(
      { clinicId, _id: data._id },
      { $set: { lastLoginAt: new Date(), 'security.failedLoginCount': 3 } },
    )
    expect(events).toHaveLength(0)
  })

  it('reads the pre-image on the same session inside a transaction', async () => {
    const data = newUser()
    await UserModel().create(data)
    events.length = 0

    await withTransaction(async (session) => {
      await UserModel().findOneAndUpdate(
        { clinicId, _id: data._id },
        { $set: { lastName: 'Nassar' } },
        { session },
      )
    })

    expect(events[0]).toMatchObject({
      before: { lastName: 'Haddad' },
      after: { lastName: 'Nassar' },
    })
  })

  it('records a deletion', async () => {
    const data = newUser()
    await UserModel().create(data)
    events.length = 0

    await UserModel().deleteOne({ clinicId, _id: data._id })
    expect(events[0]).toMatchObject({ operation: 'deleted', entityId: data._id, after: null })
  })

  it('holds a transaction’s events until it commits', async () => {
    const data = newUser()
    let capturedBeforeCommit = -1

    await withTransaction(async (session) => {
      await UserModel().create([data], { session })
      await UserModel().updateOne(
        { clinicId, _id: data._id },
        { $set: { firstName: 'Rana' } },
        { session },
      )
      capturedBeforeCommit = events.length
    })

    expect(capturedBeforeCommit).toBe(0)
    expect(events.map((event) => event.operation)).toEqual(['created', 'updated'])
  })

  it('records nothing for a transaction that rolls back', async () => {
    const data = newUser()

    await expect(
      withTransaction(async (session) => {
        await UserModel().create([data], { session })
        throw new Error('roll back')
      }),
    ).rejects.toThrow('roll back')

    expect(events).toHaveLength(0)
    expect(await UserModel().countDocuments({ clinicId, _id: data._id })).toBe(0)
  })

  it('refuses to write at all when no sink is installed — no silent unaudited write', async () => {
    setAuditSink(null)
    const data = newUser()

    await expect(UserModel().create(data)).rejects.toThrow(AuditSinkNotConfiguredError)
    await expect(
      UserModel().updateOne({ clinicId, _id: 'anything' }, { $set: { phone: '1' } }),
    ).rejects.toThrow(AuditSinkNotConfiguredError)
    expect(await UserModel().countDocuments({ clinicId, email: data.email })).toBe(0)
  })
})

describe('schema and migrations agree', () => {
  it('has every index a schema declares in the migrated database', async () => {
    const models = [
      ClinicModel(),
      UserModel(),
      RoleModel(),
      RefreshTokenModel(),
      InvitationModel(),
      PasswordResetTokenModel(),
      AuditLogModel(),
      PatientModel(),
      DoctorModel(),
      SpecialtyModel(),
      AppointmentModel(),
      SlotReservationModel(),
    ]

    for (const model of models) {
      const existing = (await model.collection.indexes()).map((index) => JSON.stringify(index.key))
      for (const [fields] of model.schema.indexes()) {
        expect(existing, `${model.modelName} is missing ${JSON.stringify(fields)}`).toContain(
          JSON.stringify(fields),
        )
      }
    }
  })
})
