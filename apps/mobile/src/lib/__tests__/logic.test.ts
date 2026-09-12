import { describe, expect, it } from 'vitest'
import type { AppointmentSummary } from '@clinic/contracts'
import {
  formatWhen,
  isCancellable,
  nextUpcoming,
  pastAppointments,
  relativeDay,
  upcomingAppointments,
} from '../format'
import { cacheKeyOf, createOfflineCache, isCacheable, isUsable, MAX_AGE_MS } from '../offline'
import { destinationOf } from '../notification-routing'

const appointment = (over: Partial<AppointmentSummary> = {}): AppointmentSummary =>
  ({
    id: 'a1',
    number: 'APT-000001',
    status: 'SCHEDULED',
    source: 'PATIENT',
    startsAt: '2026-09-20T09:00:00.000Z',
    endsAt: '2026-09-20T09:30:00.000Z',
    durationMinutes: 30,
    reason: null,
    patient: { id: 'p1', name: 'Rami', medicalRecordNo: 'MRN-000001' },
    doctor: { id: 'd1', name: 'Dr Haddad' },
    branchId: null,
    ...over,
  }) as AppointmentSummary

const NOW = new Date('2026-09-19T10:00:00.000Z')

describe('when an appointment is', () => {
  /**
   * The bug this exists to prevent: telling a travelling patient the time on *their* phone rather
   * than the time at the clinic door.
   */
  it('is shown in the clinic’s timezone, not the device’s', () => {
    const utc = formatWhen('2026-09-20T06:00:00.000Z', 'UTC')
    const beirut = formatWhen('2026-09-20T06:00:00.000Z', 'Asia/Beirut')

    expect(utc).toContain('06:00')
    // Beirut is UTC+3 in September: the same instant, three hours later on the wall.
    expect(beirut).toContain('09:00')
    expect(utc).not.toBe(beirut)
  })

  it('renders an unparseable timestamp as a dash rather than "Invalid Date"', () => {
    expect(formatWhen('not a date', 'UTC')).toBe('—')
  })

  it('says today, tomorrow, or how many days', () => {
    expect(relativeDay('2026-09-19T15:00:00.000Z', 'UTC', NOW)).toBe('today')
    expect(relativeDay('2026-09-20T09:00:00.000Z', 'UTC', NOW)).toBe('tomorrow')
    expect(relativeDay('2026-09-24T09:00:00.000Z', 'UTC', NOW)).toBe('in 5 days')
    // Something in the past has no "in N days" to offer.
    expect(relativeDay('2026-09-01T09:00:00.000Z', 'UTC', NOW)).toBe('')
  })
})

describe('which appointment is next', () => {
  it('is the soonest one that has not happened', () => {
    const list = [
      appointment({ id: 'later', startsAt: '2026-09-25T09:00:00.000Z' }),
      appointment({ id: 'sooner', startsAt: '2026-09-21T09:00:00.000Z' }),
    ]
    expect(nextUpcoming(list, NOW)?.id).toBe('sooner')
  })

  it('does not assume the API sorted them', () => {
    // It does today. A home screen that showed the wrong appointment because that changed is not
    // a trade worth making for one sort.
    const list = [
      appointment({ id: 'c', startsAt: '2026-09-30T09:00:00.000Z' }),
      appointment({ id: 'a', startsAt: '2026-09-20T09:00:00.000Z' }),
      appointment({ id: 'b', startsAt: '2026-09-25T09:00:00.000Z' }),
    ]
    expect(upcomingAppointments(list, NOW).map((one) => one.id)).toEqual(['a', 'b', 'c'])
  })

  it('ignores cancelled and no-show slots, which hold no place in the day', () => {
    const list = [
      appointment({ id: 'cancelled', status: 'CANCELLED', startsAt: '2026-09-20T09:00:00.000Z' }),
      appointment({ id: 'noshow', status: 'NO_SHOW', startsAt: '2026-09-21T09:00:00.000Z' }),
      appointment({ id: 'real', startsAt: '2026-09-22T09:00:00.000Z' }),
    ]
    expect(nextUpcoming(list, NOW)?.id).toBe('real')
  })

  it('still counts one starting this very second', () => {
    // Blanking the home screen at exactly the moment somebody is at the desk checking it would
    // be the worst possible time to be unhelpful.
    const now = appointment({ id: 'now', startsAt: NOW.toISOString() })
    expect(nextUpcoming([now], NOW)?.id).toBe('now')
  })

  it('is null when there is nothing ahead', () => {
    expect(nextUpcoming([appointment({ startsAt: '2026-01-01T09:00:00.000Z' })], NOW)).toBeNull()
    expect(nextUpcoming([], NOW)).toBeNull()
  })

  it('puts the past newest-first, cancellations included', () => {
    const list = [
      appointment({ id: 'old', startsAt: '2026-08-01T09:00:00.000Z' }),
      appointment({ id: 'recent', startsAt: '2026-09-18T09:00:00.000Z' }),
      appointment({ id: 'cancelled', status: 'CANCELLED', startsAt: '2026-09-30T09:00:00.000Z' }),
    ]
    // A patient looking back wants to see that they cancelled; looking forward, they do not.
    expect(pastAppointments(list, NOW).map((one) => one.id)).toEqual(['cancelled', 'recent', 'old'])
  })
})

describe('offering to cancel', () => {
  it('is offered for something still ahead', () => {
    expect(isCancellable(appointment({ startsAt: '2026-09-25T09:00:00.000Z' }), NOW)).toBe(true)
  })

  it('is not offered for something past or already cancelled', () => {
    expect(isCancellable(appointment({ startsAt: '2026-09-01T09:00:00.000Z' }), NOW)).toBe(false)
    expect(isCancellable(appointment({ status: 'COMPLETED' }), NOW)).toBe(false)
    expect(isCancellable(appointment({ status: 'CANCELLED' }), NOW)).toBe(false)
  })
})

describe('what a notification opens', () => {
  it('follows an in-app path', () => {
    expect(destinationOf({ href: '/appointments' })).toBe('/appointments')
  })

  /**
   * A notification payload is attacker-influenced in principle. Following an absolute URL out of
   * one would be an open redirect with a push notification as the delivery mechanism.
   */
  it('refuses anything that leaves the app', () => {
    expect(destinationOf({ href: 'https://evil.example/steal' })).toBe('/')
    expect(destinationOf({ href: '//evil.example' })).toBe('/')
    expect(destinationOf({ href: 'javascript:alert(1)' })).toBe('/')
  })

  it('falls back to home rather than doing nothing', () => {
    // A notification that does nothing when tapped reads as a broken app, and a payload from an
    // older server is a case that will happen.
    expect(destinationOf(undefined)).toBe('/')
    expect(destinationOf({})).toBe('/')
    expect(destinationOf({ href: 42 as unknown as string })).toBe('/')
  })
})

describe('the offline cache', () => {
  it('keeps only what is worth reading with no signal', () => {
    // A device holds PHI at rest and the less of it the better. A cached statement is a liability
    // on a lost phone with no corresponding benefit.
    expect(isCacheable(['appointments', {}])).toBe(true)
    expect(isCacheable(['me'])).toBe(true)
    expect(isCacheable(['notifications', {}])).toBe(true)

    expect(isCacheable(['billing', 'statement', 'p1'])).toBe(false)
    expect(isCacheable(['files', {}])).toBe(false)
    expect(isCacheable(['prescriptions', {}])).toBe(false)
  })

  it('refuses an entry older than a day', () => {
    const now = Date.now()
    // A week-old appointment list is not "slightly out of date", it is a different week — and
    // showing it with an "offline" label would still have somebody turn up on the wrong day.
    expect(isUsable({ data: {}, fetchedAt: now - 1000 }, now)).toBe(true)
    expect(isUsable({ data: {}, fetchedAt: now - MAX_AGE_MS - 1 }, now)).toBe(false)
  })

  it('distrusts an entry from the future, which means the clock moved', () => {
    const now = Date.now()
    expect(isUsable({ data: {}, fetchedAt: now + 60_000 }, now)).toBe(false)
    expect(isUsable({ data: {}, fetchedAt: Number.NaN }, now)).toBe(false)
  })

  it('round-trips a cacheable query and ignores an uncacheable one', async () => {
    const store = new Map<string, string>()
    const cache = createOfflineCache(memoryStorage(store))

    await cache.write(['appointments', { patientId: 'p1' }], [{ id: 'a1' }])
    expect(await cache.read(['appointments', { patientId: 'p1' }])).toEqual([{ id: 'a1' }])

    await cache.write(['files', {}], [{ id: 'f1' }])
    expect(await cache.read(['files', {}])).toBeUndefined()
    expect(store.has(cacheKeyOf(['files', {}]))).toBe(false)
  })

  it('treats corrupt storage as a miss, not a crash on launch', async () => {
    const store = new Map([[cacheKeyOf(['me']), 'not json']])
    const cache = createOfflineCache(memoryStorage(store))

    expect(await cache.read(['me'])).toBeUndefined()
    expect(store.size).toBe(0)
  })

  it('drops a stale entry rather than showing it', async () => {
    const store = new Map<string, string>()
    let clock = 1_000_000
    const cache = createOfflineCache(memoryStorage(store), () => clock)

    await cache.write(['me'], { id: 'u1' })
    clock += MAX_AGE_MS + 1
    expect(await cache.read(['me'])).toBeUndefined()
  })

  it('clears everything on sign-out', async () => {
    // The next person to sign in on a shared phone must not see the previous one's appointments
    // while their own load.
    const store = new Map<string, string>()
    const cache = createOfflineCache(memoryStorage(store))

    await cache.write(['me'], { id: 'u1' })
    await cache.write(['appointments', {}], [])
    store.set('something.else', 'kept')

    await cache.clear()
    expect([...store.keys()]).toEqual(['something.else'])
  })
})

function memoryStorage(store: Map<string, string>) {
  return {
    getItem: async (key: string) => store.get(key) ?? null,
    setItem: async (key: string, value: string) => void store.set(key, value),
    removeItem: async (key: string) => void store.delete(key),
    keys: async () => [...store.keys()],
  }
}
