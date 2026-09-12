import { beforeAll, describe, expect, it } from 'vitest'
import { env } from '@clinic/config'
import {
  AuditLogModel,
  ClinicModel,
  NotificationModel,
  RoleModel,
  UserModel,
  connect,
  newId,
} from '@clinic/db'
import { SYSTEM_ROLES, usersHolding } from '@clinic/core/access'
import { flushAudit, recordAudit } from '@clinic/core/audit'
import { bootstrapServer } from '@clinic/core/server'
import { verifyAuditChainNightly } from '../src/jobs/verify-chain'

const clinicId = () => env().CLINIC_ID

/**
 * An admin who holds `audit:read` — the audience the alert has to reach.
 *
 * Seeded directly rather than through the sign-up flow: this suite is about the job, and the one
 * thing it needs from the rest of the system is somebody to wake.
 */
async function seedAnAdmin(): Promise<void> {
  await ClinicModel().findOneAndUpdate(
    { _id: clinicId() },
    {
      $set: {
        name: 'Chain Clinic',
        timezone: 'Asia/Beirut',
        currency: 'USD',
        locale: 'en',
        isActive: true,
      },
      $setOnInsert: { permissionVersion: 1, branches: [], holidays: [] },
    },
    { upsert: true },
  )

  const definition = SYSTEM_ROLES.find((role) => role.key === 'admin')
  await RoleModel().findOneAndUpdate(
    { clinicId: clinicId(), key: 'admin' },
    {
      $set: {
        name: 'Administrator',
        priority: 40,
        isSystem: true,
        isDefault: false,
        permissions: (definition?.grants ?? []).map(({ key, scope }) => ({ key, scope })),
      },
      $setOnInsert: { _id: newId(), clinicId: clinicId(), key: 'admin' },
    },
    { upsert: true, new: true },
  )
  const role = await RoleModel().findOne({ clinicId: clinicId(), key: 'admin' }).lean()

  const userId = newId()
  await UserModel().create({
    _id: userId,
    clinicId: clinicId(),
    email: `chain-${userId.slice(0, 8)}@clinic.local`,
    firstName: 'Maya',
    lastName: 'Haddad',
    status: 'ACTIVE',
    roles: [{ roleId: role?._id ?? newId() }],
    passwordHash: 'x',
  })
}

beforeAll(async () => {
  await connect()
  bootstrapServer()
  await seedAnAdmin()
  await flushAudit()
})

/** Something to chain, so the run has links to walk. */
async function anEntry(action: string): Promise<void> {
  await recordAudit({
    action,
    category: 'SYSTEM',
    clinicId: clinicId(),
    metadata: { marker: newId() },
  })
  await flushAudit()
}

describe('the nightly chain verification', () => {
  it('passes on an intact chain, and records that it ran', async () => {
    await anEntry('worker.probe')
    const result = await verifyAuditChainNightly()

    expect(result.ok).toBe(true)
    expect(result.checked).toBeGreaterThan(0)
    expect(result.alerted).toBe(0)
    await flushAudit()

    const recorded = await AuditLogModel().countDocuments({
      clinicId: clinicId(),
      action: 'audit.chain_verified',
    })
    expect(recorded).toBeGreaterThan(0)
  })

  it('raises a CRITICAL entry and wakes everybody who can read the log', async () => {
    await anEntry('worker.before-damage')
    // A first run, so the next one resumes from a known-good bookmark rather than genesis.
    await verifyAuditChainNightly()
    await anEntry('worker.damaged')

    const entry = (await AuditLogModel()
      .findOne({ clinicId: clinicId(), action: 'worker.damaged' })
      .lean()) as unknown as { _id: string }

    // Go under the application, as somebody with database access would.
    await AuditLogModel().collection.updateOne(
      { _id: entry._id as never },
      { $set: { action: 'worker.innocent' } },
    )

    try {
      const result = await verifyAuditChainNightly()
      expect(result.ok).toBe(false)
      expect(result.reason).toBe('HASH_MISMATCH')

      const audience = await usersHolding(clinicId(), 'audit:read')
      expect(audience.length).toBeGreaterThan(0)
      // Everybody who can read the log hears about it — the alert is not mutable by preference.
      expect(result.alerted).toBe(audience.length)
      await flushAudit()

      const critical = (await AuditLogModel()
        .findOne({ clinicId: clinicId(), action: 'audit.chain_broken' })
        .sort({ occurredAt: -1 })
        .lean()) as unknown as { severity: string; outcome: string } | null
      expect(critical?.severity).toBe('CRITICAL')
      expect(critical?.outcome).toBe('FAILURE')

      const notification = await NotificationModel()
        .findOne({ clinicId: clinicId(), type: 'AUDIT_CHAIN_BROKEN' })
        .sort({ createdAt: -1 })
        .lean()
      expect(notification).toBeTruthy()

      // A job that keeps finding the same break must not send a fresh alert every six hours.
      const again = await verifyAuditChainNightly()
      expect(again.ok).toBe(false)
      expect(again.alerted).toBe(0)
    } finally {
      await AuditLogModel().collection.updateOne(
        { _id: entry._id as never },
        { $set: { action: 'worker.damaged' } },
      )
    }

    expect((await verifyAuditChainNightly()).ok).toBe(true)
  })
})
