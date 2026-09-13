import { describe, expect, it } from 'vitest'
import {
  canonicalJson,
  decide,
  fingerprintOf,
  isReplayable,
  isValidIdempotencyKey,
} from '../domain/idempotency'

const NOW = new Date('2026-09-20T10:00:00.000Z')

describe('what counts as the same request', () => {
  it('is the same body whatever order its fields were serialised in', () => {
    // A client that re-serialises a retry has not sent a different request.
    expect(fingerprintOf({ doctorId: 'd1', startsAt: 'x', reason: null })).toBe(
      fingerprintOf({ reason: null, startsAt: 'x', doctorId: 'd1' }),
    )
    expect(canonicalJson({ b: [2, { d: 1, c: 0 }], a: 'x' })).toBe(
      '{"a":"x","b":[2,{"c":0,"d":1}]}',
    )
  })

  it('is a different body when any value differs, including null against absent', () => {
    expect(fingerprintOf({ startsAt: '09:00' })).not.toBe(fingerprintOf({ startsAt: '09:20' }))
    expect(fingerprintOf({ reason: null })).not.toBe(fingerprintOf({}))
  })

  it('treats an absent field and an undefined one alike, as JSON does', () => {
    expect(fingerprintOf({ a: 1, b: undefined })).toBe(fingerprintOf({ a: 1 }))
  })
})

describe('a key already seen', () => {
  const record = (over: Partial<Parameters<typeof decide>[0]> = {}) => ({
    state: 'DONE' as const,
    fingerprint: 'same',
    lockedUntil: null,
    ...over,
  })

  it('replays the answer when the request matches', () => {
    expect(decide(record(), 'same', NOW)).toBe('replay')
  })

  /**
   * Replaying the first answer to a different body would tell somebody they booked a time they did
   * not choose — so a mismatch is refused, whatever state the first request is in.
   */
  it('refuses a different body, finished or still running', () => {
    expect(decide(record(), 'other', NOW)).toBe('mismatch')
    expect(
      decide(
        record({ state: 'IN_FLIGHT', lockedUntil: new Date(NOW.getTime() + 5000) }),
        'other',
        NOW,
      ),
    ).toBe('mismatch')
  })

  it('asks the client to wait while the first request is running', () => {
    expect(
      decide(
        record({ state: 'IN_FLIGHT', lockedUntil: new Date(NOW.getTime() + 5000) }),
        'same',
        NOW,
      ),
    ).toBe('busy')
  })

  it('takes over a claim whose request died and whose lease has run out', () => {
    expect(
      decide(record({ state: 'IN_FLIGHT', lockedUntil: new Date(NOW.getTime() - 1) }), 'same', NOW),
    ).toBe('takeOver')
  })
})

describe('what is kept for replay', () => {
  it('keeps answers — a success, or a refusal the domain made', () => {
    expect(isReplayable(201)).toBe(true)
    expect(isReplayable(409)).toBe(true)
    expect(isReplayable(422)).toBe(true)
  })

  it('does not keep a server error, which is a failure to answer rather than an answer', () => {
    expect(isReplayable(500)).toBe(false)
    expect(isReplayable(503)).toBe(false)
  })
})

describe('a key', () => {
  it('accepts what clients sensibly mint', () => {
    expect(isValidIdempotencyKey('7c3f8a2e-5b1d-4e6a-9f0c-2d4b6e8a1c3f')).toBe(true)
    expect(isValidIdempotencyKey('01J8Z3QF6X2M4N5P7R9S0T1V2W')).toBe(true)
    expect(isValidIdempotencyKey('parity-doctor-1726000000000')).toBe(true)
  })

  it('refuses what is too short to be unique, too long to keep, or not a token', () => {
    expect(isValidIdempotencyKey('abc')).toBe(false)
    expect(isValidIdempotencyKey('x'.repeat(129))).toBe(false)
    expect(isValidIdempotencyKey('has spaces in it')).toBe(false)
    expect(isValidIdempotencyKey('{"$ne":null}')).toBe(false)
  })
})
