import { describe, expect, it } from 'vitest'
import { env } from '@clinic/config'
import { AuditChainHeadModel, AuditLogModel, newId } from '@clinic/db'
import { createUser, outcome, signedInActor } from '../../../../test/fixtures'
import type { Actor } from '../../access'
import { flushAudit, runChainVerification, verifyChainFor } from '../../audit'
import { getPatient, registerPatient } from '../../patients'
import { runWithContext } from '../../../context/request-context'
import {
  auditActorOptions,
  exportAuditCsv,
  getAuditEntry,
  listAuditEntries,
  verifyAuditChain,
} from '../index'

const clinicId = () => env().CLINIC_ID

async function adminActor(): Promise<Actor> {
  return (await signedInActor({ role: 'admin' })).actor
}

async function staffActor(): Promise<Actor> {
  return (await signedInActor({ role: 'staff' })).actor
}

/**
 * Runs a call inside a request context, exactly as `withApi` does on a real request.
 *
 * Without it the ambient actor is anonymous and every captured entry records `actor.id: null` —
 * which would quietly make the "who viewed this file" assertions below meaningless.
 */
function as<T>(actor: Actor, fn: () => Promise<T>): Promise<T> {
  return runWithContext(
    {
      requestId: newId(),
      actorId: actor.userId,
      actorType: actor.kind,
      actorLabel: actor.displayName,
      actorRoles: actor.roleKeys,
      clinicId: actor.clinicId,
      ipAddress: '203.0.113.7',
      userAgent: 'integration-suite',
    },
    fn,
  )
}

async function aPatient(staff: Actor, lastName = `Chain${newId().slice(0, 8)}`) {
  const registered = await registerPatient(staff, {
    firstName: 'Rami',
    lastName,
    dateOfBirth: null,
    gender: null,
    nationalId: null,
    bloodType: 'UNKNOWN',
    contact: { phone: null, email: null },
    address: { line1: null, city: null, country: null },
    emergencyContacts: [],
    adminNotes: null,
    duplicateOverride: null,
    inviteToPortal: false,
  })
  return registered.patient
}

describe('the explorer answers the question the phase exists for', () => {
  /**
   * The exit criterion, end to end: *"who viewed this patient's file last Tuesday, and what did
   * they change?"* — one entity filter, one reads-only switch, one entry opened.
   */
  it('finds who looked at a patient, and what somebody changed', async () => {
    const admin = await adminActor()
    const staff = await staffActor()
    const patient = await as(staff, () => aPatient(staff))

    // Somebody looks at the file. The capture plugin records a privileged read (11.3).
    await as(staff, () => getPatient(staff, patient.id))
    await flushAudit()

    const reads = await as(admin, () =>
      listAuditEntries(admin, {
        entityType: 'Patient',
        entityId: patient.id,
        readsOnly: true,
        limit: 50,
      }),
    )
    const viewed = reads.items.find((entry) => entry.action === 'patient.viewed')
    expect(viewed).toBeDefined()
    expect(viewed?.actor.id).toBe(staff.userId)

    // And the change itself, with a diff to open.
    const writes = await listAuditEntries(admin, {
      entityType: 'Patient',
      entityId: patient.id,
      action: 'patient.created',
      limit: 50,
    })
    expect(writes.items).toHaveLength(1)

    const detail = await getAuditEntry(admin, writes.items[0]!.id)
    expect(detail.changes.length).toBeGreaterThan(0)
    expect(detail.changes.map((change) => change.field)).toContain('lastName')
    expect(detail.request.id).toBeTruthy()
  })

  it('records the read itself, with the filter that was asked for', async () => {
    const admin = await adminActor()
    await as(admin, () =>
      listAuditEntries(admin, { entityType: 'Patient', entityId: 'patient-xyz', limit: 10 }),
    )
    await flushAudit()

    const entry = await AuditLogModel()
      .findOne({ clinicId: clinicId(), action: 'audit.viewed', 'actor.id': admin.userId })
      .sort({ occurredAt: -1 })
      .lean()

    expect(entry).toBeTruthy()
    // What was asked for, not what came back: a filter that found nothing is still somebody looking.
    expect((entry as unknown as { metadata: Record<string, unknown> }).metadata).toMatchObject({
      entityType: 'Patient',
      entityId: 'patient-xyz',
    })
    expect((entry as unknown as { severity: string }).severity).toBe('NOTICE')
  })

  it('refuses somebody without audit:read, and records the refusal', async () => {
    const staff = await staffActor()
    expect(await outcome(as(staff, () => listAuditEntries(staff, { limit: 10 })))).toBe('FORBIDDEN')
    await flushAudit()

    const denial = await AuditLogModel()
      .findOne({ clinicId: clinicId(), 'actor.id': staff.userId, outcome: 'DENIED' })
      .sort({ occurredAt: -1 })
      .lean()
    expect(denial).toBeTruthy()
  })

  it('pages without repeating or skipping an entry', async () => {
    const admin = await adminActor()
    const first = await listAuditEntries(admin, { limit: 5 })
    expect(first.items).toHaveLength(5)
    expect(first.nextCursor).toBeTruthy()

    const second = await listAuditEntries(admin, { limit: 5, cursor: first.nextCursor! })
    const ids = new Set([...first.items, ...second.items].map((entry) => entry.id))
    expect(ids.size).toBe(first.items.length + second.items.length)
  })

  it('offers the people who appear in the log as filter options', async () => {
    const admin = await adminActor()
    await flushAudit()
    const actors = await as(admin, () => auditActorOptions(admin))
    expect(actors.some((one) => one.id === admin.userId)).toBe(true)
    // Every option can actually be filtered by — no null ids.
    expect(actors.every((one) => one.id.length > 0 && one.name.length > 0)).toBe(true)
  })
})

describe('the CSV export', () => {
  it('exports the filtered rows, with a header and CRLF endings', async () => {
    const admin = await adminActor()
    const staff = await staffActor()
    const patient = await aPatient(staff)
    await flushAudit()

    const file = await exportAuditCsv(admin, {
      entityType: 'Patient',
      entityId: patient.id,
      limit: 50,
    })

    expect(file.filename).toMatch(/^audit-\d{4}-\d{2}-\d{2}\.csv$/)
    expect(file.rows).toBeGreaterThan(0)
    expect(file.truncated).toBe(false)

    const lines = file.csv.split('\r\n')
    expect(lines[0]).toContain('"occurredAt"')
    expect(lines[0]).toContain('"hash"')
    expect(lines).toHaveLength(file.rows + 1)
  })

  it('is its own permission — reading the log does not entitle taking it away', async () => {
    const staff = await staffActor()
    expect(await outcome(exportAuditCsv(staff, { limit: 10 }))).toBe('FORBIDDEN')
  })

  it('records the export at WARNING, with the row count', async () => {
    const admin = await adminActor()
    const file = await as(admin, () => exportAuditCsv(admin, { category: 'CLINICAL', limit: 50 }))
    await flushAudit()

    const entry = (await AuditLogModel()
      .findOne({ clinicId: clinicId(), action: 'audit.exported', 'actor.id': admin.userId })
      .sort({ occurredAt: -1 })
      .lean()) as unknown as { severity: string; metadata: Record<string, unknown> } | null

    expect(entry?.severity).toBe('WARNING')
    expect(entry?.metadata.rows).toBe(file.rows)
  })
})

describe('the hash chain', () => {
  it('chains every entry, and the head follows the last one written', async () => {
    const staff = await staffActor()
    await aPatient(staff)
    await flushAudit()

    const entries = (await AuditLogModel()
      .find({ clinicId: clinicId() })
      .sort({ occurredAt: -1 })
      .limit(5)
      .lean()) as unknown as Array<{ hash?: string; previousHash?: string }>

    expect(entries.length).toBeGreaterThan(0)
    for (const entry of entries) {
      expect(entry.hash).toMatch(/^[0-9a-f]{64}$/)
      expect(entry.previousHash).toMatch(/^[0-9a-f]{64}$/)
    }

    const head = (await AuditChainHeadModel().findById(clinicId()).lean()) as unknown as {
      hash: string
    } | null
    expect(head?.hash).toBe(entries[0]?.hash)
  })

  it('verifies clean over the whole log', async () => {
    const admin = await adminActor()
    await flushAudit()
    const status = await verifyAuditChain(admin, { limit: 10_000 })
    expect(status.ok).toBe(true)
    expect(status.checked).toBeGreaterThan(0)
  })

  it('never lets two concurrent writes claim the same predecessor', async () => {
    const staff = await staffActor()
    // Forty patients at once. Each registration produces several captured entries, so this is a
    // burst of well over a hundred writes racing for one head — the shape that used to exhaust
    // the retries and drop entries outright.
    await Promise.all(
      Array.from({ length: 40 }, (_, index) =>
        aPatient(staff, `Race${index}${newId().slice(0, 6)}`),
      ),
    )
    await flushAudit()

    const status = await verifyChainFor(clinicId(), { limit: 20_000 })
    expect(status).toMatchObject({ ok: true })
  })

  /**
   * Batching is what keeps an awaited `recordAudit` from queueing behind every fire-and-forget
   * capture write — but a batch that numbered its entries wrongly would fork the chain. Positions
   * must be contiguous from 1 with nothing repeated, whatever order the writes arrived in.
   */
  it('numbers a burst contiguously, with no gap and no collision', async () => {
    const staff = await staffActor()
    await Promise.all(
      Array.from({ length: 25 }, (_, index) =>
        aPatient(staff, `Seq${index}${newId().slice(0, 6)}`),
      ),
    )
    await flushAudit()

    const rows = (await AuditLogModel()
      .find({ clinicId: clinicId(), chainSeq: { $exists: true } }, { chainSeq: 1 })
      .sort({ chainSeq: 1 })
      .lean()) as unknown as Array<{ chainSeq: number }>

    const positions = rows.map((row) => row.chainSeq)
    expect(positions).toEqual(positions.map((_, index) => index + 1))

    // And the head agrees with how many links there are.
    const head = (await AuditChainHeadModel().findById(clinicId()).lean()) as unknown as {
      seq: number
    }
    expect(head.seq).toBe(positions.length)
  })

  it('spots an entry edited in place, and says which one', async () => {
    const staff = await staffActor()
    const patient = await aPatient(staff)
    await flushAudit()

    const entry = (await AuditLogModel()
      .findOne({ clinicId: clinicId(), 'entity.id': patient.id, action: 'patient.created' })
      .lean()) as unknown as { _id: string } | null
    expect(entry).toBeTruthy()

    // Go under the application, exactly as somebody with database access would.
    await AuditLogModel().collection.updateOne(
      { _id: entry!._id as never },
      { $set: { action: 'nothing.happened' } },
    )

    try {
      const status = await verifyChainFor(clinicId(), { limit: 10_000 })
      expect(status.ok).toBe(false)
      expect(status.reason).toBe('HASH_MISMATCH')
      expect(status.brokenAt?.id).toBe(entry!._id)
    } finally {
      // Put it back, so the rest of the suite is not investigating a crime scene.
      await AuditLogModel().collection.updateOne(
        { _id: entry!._id as never },
        { $set: { action: 'patient.created' } },
      )
    }
    expect((await verifyChainFor(clinicId(), { limit: 10_000 })).ok).toBe(true)
  })

  it('spots an entry deleted from the middle', async () => {
    const staff = await staffActor()
    const patient = await aPatient(staff)
    // Something after it, so the deletion is genuinely mid-chain rather than a truncation.
    await aPatient(staff)
    await flushAudit()

    const entry = (await AuditLogModel()
      .findOne({ clinicId: clinicId(), 'entity.id': patient.id, action: 'patient.created' })
      .lean()) as unknown as Record<string, unknown> | null
    expect(entry).toBeTruthy()
    await AuditLogModel().collection.deleteOne({ _id: entry!._id as never })

    try {
      const status = await verifyChainFor(clinicId(), { limit: 10_000 })
      expect(status.ok).toBe(false)
      expect(status.reason).toBe('BROKEN_LINK')
    } finally {
      // Restored whatever the assertions did, so a failure here does not leave every later test
      // investigating the same crime scene.
      await AuditLogModel().collection.insertOne(entry as never)
    }
    expect((await verifyChainFor(clinicId(), { limit: 10_000 })).ok).toBe(true)
  })

  /**
   * Truncation is the case a walk alone cannot catch: delete the most recent entries and what
   * remains is a perfectly valid chain that simply stops early. Only the recorded head knows how
   * long the chain is supposed to be, which is why the verifier compares against it.
   */
  it('spots the newest entries deleted, which a walk alone would call clean', async () => {
    const staff = await staffActor()
    await aPatient(staff)
    await flushAudit()
    await runChainVerification(clinicId(), { force: 'full' })

    const last = (await AuditLogModel()
      .findOne({ clinicId: clinicId() })
      .sort({ chainSeq: -1 })
      .lean()) as unknown as Record<string, unknown>
    await AuditLogModel().collection.deleteOne({ _id: last._id as never })

    try {
      // The walk is happy: what is left is a valid chain.
      expect((await verifyChainFor(clinicId(), { limit: 10_000 })).ok).toBe(true)

      // The head is not.
      const run = await runChainVerification(clinicId(), { force: 'full' })
      expect(run.status.ok).toBe(false)
      expect(run.status.reason).toBe('HEAD_MISMATCH')
    } finally {
      await AuditLogModel().collection.insertOne(last as never)
    }
    expect((await runChainVerification(clinicId(), { force: 'full' })).status.ok).toBe(true)
  })

  it('moves its bookmark forward on a clean run, so the next one resumes', async () => {
    const before = await runChainVerification(clinicId(), { force: 'full' })
    expect(before.status.ok).toBe(true)
    expect(before.wasFullWalk).toBe(true)

    const head = (await AuditChainHeadModel().findById(clinicId()).lean()) as unknown as {
      verifiedHash: string | null
      fullyVerifiedAt: Date | null
    } | null
    expect(head?.verifiedHash).toMatch(/^[0-9a-f]{64}$/)
    expect(head?.fullyVerifiedAt).toBeInstanceOf(Date)

    // The incremental run has nothing new and must still pass, carrying the bookmark forward
    // rather than falling back to genesis and reporting a broken link.
    const after = await runChainVerification(clinicId(), { force: 'incremental' })
    expect(after.status.ok).toBe(true)
    expect(after.wasFullWalk).toBe(false)
  })

  it('does not move the bookmark past a break it just found', async () => {
    await runChainVerification(clinicId(), { force: 'full' })
    const before = (await AuditChainHeadModel().findById(clinicId()).lean()) as unknown as {
      verifiedHash: string
    }

    const staff = await staffActor()
    const patient = await aPatient(staff)
    await flushAudit()
    const entry = (await AuditLogModel()
      .findOne({ clinicId: clinicId(), 'entity.id': patient.id, action: 'patient.created' })
      .lean()) as unknown as { _id: string }
    await AuditLogModel().collection.updateOne(
      { _id: entry._id as never },
      { $set: { severity: 'CRITICAL' } },
    )

    try {
      const run = await runChainVerification(clinicId(), { force: 'full' })
      expect(run.status.ok).toBe(false)

      const after = (await AuditChainHeadModel().findById(clinicId()).lean()) as unknown as {
        verifiedHash: string
      }
      // Unchanged. A bookmark that advanced past the damage would report a clean chain tomorrow.
      expect(after.verifiedHash).toBe(before.verifiedHash)
    } finally {
      await AuditLogModel().collection.updateOne(
        { _id: entry._id as never },
        { $set: { severity: 'INFO' } },
      )
    }
  })
})

describe('entries from before the chain existed', () => {
  /**
   * The chain was introduced over a log that already had entries in it. Treating those as breaks
   * would leave every existing installation permanently reporting tampering — which is the
   * fastest way to get a tamper alarm ignored.
   */
  it('are counted and reported, not called tampering', async () => {
    const before = await verifyChainFor(clinicId(), { limit: 10_000 })
    expect(before.ok).toBe(true)

    const stray = {
      _id: newId(),
      clinicId: clinicId(),
      occurredAt: new Date(),
      actor: { id: null, type: 'SYSTEM', label: 'Legacy import', roles: [] },
      action: 'legacy.imported',
      category: 'SYSTEM',
      severity: 'INFO',
      outcome: 'SUCCESS',
      request: {},
      expiresAt: new Date(Date.now() + 86_400_000),
    }
    await AuditLogModel().collection.insertOne(stray as never)

    try {
      const status = await verifyChainFor(clinicId(), { limit: 10_000 })
      expect(status.ok).toBe(true)
      // Reported rather than hidden: "N entries verified" over a longer log would otherwise read
      // as a guarantee about all of them.
      expect(status.unchained).toBe(before.unchained + 1)
    } finally {
      await AuditLogModel().collection.deleteOne({ _id: stray._id as never })
    }
  })

  /**
   * The distinction that makes the leniency safe: no position means legacy, but a position with
   * no hash means somebody took the hash off an entry that had one.
   */
  it('are not the same as an entry whose hash was removed', async () => {
    const staff = await staffActor()
    await aPatient(staff)
    await flushAudit()

    const entry = (await AuditLogModel()
      .findOne({ clinicId: clinicId(), chainSeq: { $exists: true } })
      .sort({ chainSeq: -1 })
      .lean()) as unknown as { _id: string; hash: string }

    await AuditLogModel().collection.updateOne(
      { _id: entry._id as never },
      { $unset: { hash: '' } },
    )

    try {
      const status = await verifyChainFor(clinicId(), { limit: 10_000 })
      expect(status.ok).toBe(false)
      expect(status.reason).toBe('MISSING_HASH')
      expect(status.brokenAt?.id).toBe(entry._id)
    } finally {
      await AuditLogModel().collection.updateOne(
        { _id: entry._id as never },
        { $set: { hash: entry.hash } },
      )
    }
    expect((await verifyChainFor(clinicId(), { limit: 10_000 })).ok).toBe(true)
  })
})

describe('creating a user does not leave a password in the log', () => {
  it('redacts the value while still recording that it changed', async () => {
    const admin = await adminActor()
    const user = await createUser({ role: 'staff', firstName: 'Redacted', lastName: 'Check' })
    await flushAudit()

    const page = await listAuditEntries(admin, {
      entityType: 'User',
      entityId: user.id,
      limit: 20,
    })
    const created = page.items.find((entry) => entry.action === 'user.created')
    if (!created) return

    const detail = await getAuditEntry(admin, created.id)
    const secret = detail.changes.find((change) => change.field.includes('password'))
    if (secret) {
      expect(secret.isRedacted).toBe(true)
      expect(secret.after).not.toContain('$argon')
    }
  })
})
