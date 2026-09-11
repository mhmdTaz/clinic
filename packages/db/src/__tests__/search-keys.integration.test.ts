import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { connect, disconnect, newId } from '../index'
import { UserModel } from '../models/index'
import { setAuditSink } from '../plugins/audit-capture'

/** Requires the local stack: pnpm infra:up. Runs against the dedicated test database. */
const clinicId = `c_${newId()}`

beforeAll(async () => {
  await connect()
  setAuditSink(() => undefined)
})

afterAll(async () => {
  await UserModel().deleteMany({ clinicId })
  setAuditSink(null)
  await disconnect()
})

async function searchOf(id: string) {
  const raw = await UserModel().collection.findOne({ _id: id as never })
  return (raw as { search?: Record<string, unknown> } | null)?.search
}

describe('search keys (live)', () => {
  it('derives the keys when a document is created', async () => {
    const id = newId()
    await UserModel().create({
      _id: id,
      clinicId,
      email: `Keys${id}@ITest.local`,
      firstName: 'Hélène',
      lastName: 'Abou  Jaoudé',
      status: 'INVITED',
    })

    expect(await searchOf(id)).toEqual({
      firstName: 'helene',
      lastName: 'abou jaoude',
      email: `keys${id}@itest.local`,
    })
  })

  it('follows a query update, whether the field is dotted, nested or plain', async () => {
    const id = newId()
    await UserModel().create({
      _id: id,
      clinicId,
      email: `update${id}@itest.local`,
      firstName: 'Maya',
      lastName: 'Haddad',
      status: 'INVITED',
    })

    await UserModel().updateOne({ clinicId, _id: id }, { $set: { lastName: 'Khoury' } })
    await UserModel().findOneAndUpdate({ clinicId, _id: id }, { firstName: 'Rîma' })

    expect(await searchOf(id)).toMatchObject({ firstName: 'rima', lastName: 'khoury' })
  })

  it('fills keys from $setOnInsert when an upsert creates the document', async () => {
    const email = `upsert${newId()}@itest.local`
    await UserModel().findOneAndUpdate(
      { clinicId, email },
      {
        $set: { firstName: 'Omar', lastName: 'Saad' },
        $setOnInsert: { _id: newId(), clinicId, email, status: 'INVITED' },
      },
      { upsert: true },
    )

    const created = await UserModel().findOne({ clinicId, email }).lean()
    expect(created?.search).toMatchObject({ firstName: 'omar', lastName: 'saad', email })
  })
})
