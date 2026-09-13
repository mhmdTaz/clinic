import { describe, expect, it } from 'vitest'
import { env } from '@clinic/config'
import { IdempotencyKeyModel, newId } from '@clinic/db'
import { outcome } from '../../../../test/fixtures'
import { IN_FLIGHT_LEASE_MS } from '../domain/idempotency'
import { claimIdempotencyKey, settleIdempotencyKey } from '../application/keys'

const clinicId = () => env().CLINIC_ID
const key = () => `test-${newId()}`
const scope = (who = 'user:u1') => `${who} POST /api/v1/me/appointments`
const booking = { doctorId: 'd1', startsAt: '2026-09-21T06:00:00.000Z', reason: null }

async function claimed(input: { key: string; scope?: string; body?: unknown }, now?: Date) {
  const result = await claimIdempotencyKey(
    {
      clinicId: clinicId(),
      scope: input.scope ?? scope(),
      key: input.key,
      body: input.body ?? booking,
    },
    now,
  )
  if (result.kind !== 'proceed') throw new Error(`expected to proceed, got ${result.kind}`)
  return result.claim
}

describe('honouring an Idempotency-Key', () => {
  it('replays the first answer to a retry, status and body alike', async () => {
    const k = key()
    const claim = await claimed({ key: k })
    await settleIdempotencyKey(claim, {
      status: 201,
      body: { data: { id: 'apt_1', status: 'SCHEDULED' }, meta: {} },
    })

    const retry = await claimIdempotencyKey({
      clinicId: clinicId(),
      scope: scope(),
      key: k,
      body: booking,
    })
    expect(retry).toEqual({
      kind: 'replay',
      status: 201,
      body: { data: { id: 'apt_1', status: 'SCHEDULED' }, meta: {} },
    })
  })

  it('replays a refusal the domain made, so a retry is told the same thing', async () => {
    const k = key()
    const claim = await claimed({ key: k })
    const refusal = {
      error: { code: 'SLOT_TAKEN', message: 'That slot was just booked by someone else.' },
    }
    await settleIdempotencyKey(claim, { status: 409, body: refusal })

    const retry = await claimIdempotencyKey({
      clinicId: clinicId(),
      scope: scope(),
      key: k,
      body: booking,
    })
    expect(retry).toMatchObject({ kind: 'replay', status: 409, body: refusal })
  })

  it('refuses the same key on a different body', async () => {
    const k = key()
    await settleIdempotencyKey(await claimed({ key: k }), { status: 201, body: { data: {} } })

    expect(
      await outcome(
        claimIdempotencyKey({
          clinicId: clinicId(),
          scope: scope(),
          key: k,
          body: { ...booking, startsAt: '2026-09-21T06:20:00.000Z' },
        }),
      ),
    ).toBe('IDEMPOTENCY_KEY_REUSED')
  })

  it('asks a retry to wait while the first request is still running', async () => {
    const k = key()
    await claimed({ key: k })
    expect(
      await outcome(
        claimIdempotencyKey({ clinicId: clinicId(), scope: scope(), key: k, body: booking }),
      ),
    ).toBe('IDEMPOTENCY_KEY_IN_USE')
  })

  /**
   * Two taps arriving together. The unique index is the lock: exactly one runs the work, and the
   * other is told to wait — never both running, never both refused.
   */
  it('lets exactly one of two simultaneous requests through', async () => {
    const k = key()
    const results = await Promise.allSettled(
      Array.from({ length: 2 }, () =>
        claimIdempotencyKey({ clinicId: clinicId(), scope: scope(), key: k, body: booking }),
      ),
    )
    const proceeded = results.filter(
      (result) => result.status === 'fulfilled' && result.value.kind === 'proceed',
    )
    const waiting = results.filter(
      (result) =>
        result.status === 'rejected' &&
        (result.reason as { code?: string }).code === 'IDEMPOTENCY_KEY_IN_USE',
    )
    expect(proceeded).toHaveLength(1)
    expect(waiting).toHaveLength(1)
  })

  it('releases the key after a server error, so the retry runs the work again', async () => {
    const k = key()
    await settleIdempotencyKey(await claimed({ key: k }), { status: 500, body: null })

    const retry = await claimIdempotencyKey({
      clinicId: clinicId(),
      scope: scope(),
      key: k,
      body: booking,
    })
    expect(retry.kind).toBe('proceed')
  })

  it('takes over a claim whose request died, once its lease has run out', async () => {
    const k = key()
    const started = new Date()
    const abandoned = await claimed({ key: k }, started)

    const later = new Date(started.getTime() + IN_FLIGHT_LEASE_MS + 1000)
    const retry = await claimIdempotencyKey(
      { clinicId: clinicId(), scope: scope(), key: k, body: booking },
      later,
    )
    expect(retry.kind).toBe('proceed')

    // The abandoned request coming back to life must not write its answer over the retry's.
    await settleIdempotencyKey(abandoned, { status: 201, body: { data: { id: 'stale' } } })
    if (retry.kind !== 'proceed') throw new Error('unreachable')
    await settleIdempotencyKey(retry.claim, { status: 201, body: { data: { id: 'fresh' } } })

    const replay = await claimIdempotencyKey({
      clinicId: clinicId(),
      scope: scope(),
      key: k,
      body: booking,
    })
    expect(replay).toMatchObject({ kind: 'replay', body: { data: { id: 'fresh' } } })
  })

  it('never matches a key across people or routes', async () => {
    const k = key()
    await settleIdempotencyKey(await claimed({ key: k, scope: scope('user:u1') }), {
      status: 201,
      body: { data: { id: 'theirs' } },
    })

    const someoneElse = await claimIdempotencyKey({
      clinicId: clinicId(),
      scope: scope('user:u2'),
      key: k,
      body: booking,
    })
    expect(someoneElse.kind).toBe('proceed')
  })

  it('refuses a key that is not a token, before storing anything', async () => {
    expect(
      await outcome(
        claimIdempotencyKey({ clinicId: clinicId(), scope: scope(), key: 'short', body: booking }),
      ),
    ).toBe('VALIDATION_FAILED')
    expect(await IdempotencyKeyModel().countDocuments({ clinicId: clinicId(), key: 'short' })).toBe(
      0,
    )
  })

  it('expires, through the TTL index rather than a job', async () => {
    const k = key()
    await claimed({ key: k })
    const stored = await IdempotencyKeyModel().findOne({ clinicId: clinicId(), key: k }).lean()
    const lifetime = (stored?.expiresAt?.getTime() ?? 0) - Date.now()
    expect(lifetime).toBeGreaterThan(23 * 60 * 60 * 1000)
    expect(lifetime).toBeLessThanOrEqual(24 * 60 * 60 * 1000)

    const indexes = await IdempotencyKeyModel().collection.indexes()
    expect(indexes.find((index) => index.name === 'idempotency_ttl')?.expireAfterSeconds).toBe(0)
  })
})
