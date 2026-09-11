import { describe, expect, it } from 'vitest'
import {
  LOCKOUT_POLICY,
  failuresAreForgiven,
  isLocked,
  lockDurationSeconds,
  lockedUntilAfter,
  secondsUntil,
} from '../domain/lockout'

describe('lockDurationSeconds', () => {
  it('leaves the first four failures unlocked', () => {
    expect([0, 1, 2, 3, 4].map(lockDurationSeconds)).toEqual([0, 0, 0, 0, 0])
  })

  it('doubles from the fifth failure: 30s, 1m, 2m, 4m, 8m', () => {
    expect([5, 6, 7, 8, 9].map(lockDurationSeconds)).toEqual([30, 60, 120, 240, 480])
  })

  it('holds at 15 minutes from the tenth failure on', () => {
    expect([10, 11, 50, 10_000].map(lockDurationSeconds)).toEqual([900, 900, 900, 900])
  })

  it('never exceeds the cap', () => {
    for (let failures = 0; failures < 200; failures += 1) {
      expect(lockDurationSeconds(failures)).toBeLessThanOrEqual(LOCKOUT_POLICY.maxLockSeconds)
    }
  })
})

describe('lockedUntilAfter', () => {
  const now = new Date('2026-09-11T10:00:00Z')

  it('returns null while failures are still free', () => {
    expect(lockedUntilAfter(4, now)).toBeNull()
  })

  it('locks relative to the moment of the failure', () => {
    expect(lockedUntilAfter(5, now)?.toISOString()).toBe('2026-09-11T10:00:30.000Z')
  })
})

describe('failuresAreForgiven', () => {
  const now = new Date('2026-09-11T10:00:00Z')

  it('forgives when there is no earlier failure', () => {
    expect(failuresAreForgiven(null, now)).toBe(true)
  })

  it('keeps counting within 24 hours', () => {
    expect(failuresAreForgiven(new Date('2026-09-10T10:00:01Z'), now)).toBe(false)
  })

  it('forgives at exactly 24 hours', () => {
    expect(failuresAreForgiven(new Date('2026-09-10T10:00:00Z'), now)).toBe(true)
  })
})

describe('isLocked and secondsUntil', () => {
  const now = new Date('2026-09-11T10:00:00Z')

  it('is locked only while the lock is in the future', () => {
    expect(isLocked(new Date('2026-09-11T10:00:01Z'), now)).toBe(true)
    expect(isLocked(new Date('2026-09-11T10:00:00Z'), now)).toBe(false)
    expect(isLocked(null, now)).toBe(false)
    expect(isLocked(undefined, now)).toBe(false)
  })

  it('rounds up and never tells a client to retry in zero seconds', () => {
    expect(secondsUntil(new Date('2026-09-11T10:00:00.200Z'), now)).toBe(1)
    expect(secondsUntil(new Date('2026-09-11T10:00:29.001Z'), now)).toBe(30)
    expect(secondsUntil(new Date('2026-09-11T09:59:00Z'), now)).toBe(1)
  })
})
