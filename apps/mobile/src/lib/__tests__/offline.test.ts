import { afterEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, dehydrate } from '@tanstack/react-query'
import type { SessionUser } from '@clinic/contracts'
import {
  createOfflineStore,
  decideLaunch,
  isCacheable,
  isUsable,
  keptUser,
  MAX_AGE_MS,
  restorable,
  type KeptReads,
  type Vault,
} from '../offline'
import { createOfflineSession } from '../offline-session'
import { decodeUtf8, encodeUtf8 } from '../utf8'

const user = (id = 'u1'): SessionUser =>
  ({
    id,
    email: `${id}@clinic.test`,
    firstName: 'Sara',
    lastName: 'Karam',
    displayName: 'Sara Karam',
    phone: null,
    status: 'ACTIVE',
    roles: [],
    portals: ['patient'],
    preferredPortal: null,
    landingPath: '/patient',
    patientId: 'p1',
    doctorId: null,
    clinic: { id: 'c1', name: 'Clinic', timezone: 'Asia/Beirut', locale: 'en' },
  }) as SessionUser

function memoryVault() {
  const vault = {
    held: null as string | null,
    destroyed: 0,
    failRead: false,
    read: vi.fn(async () => {
      if (vault.failRead) throw new Error('The operation couldn’t be completed (decryption failed)')
      return vault.held
    }),
    write: vi.fn(async (text: string) => {
      vault.held = text
    }),
    destroy: vi.fn(async () => {
      vault.held = null
      vault.destroyed += 1
    }),
  }
  return vault satisfies Vault
}

/** A dehydrated cache, as a real QueryClient produces one. */
function stateWith(entries: Array<{ key: unknown[]; data: unknown; at: number }>) {
  const client = new QueryClient()
  for (const entry of entries) client.setQueryData(entry.key, entry.data, { updatedAt: entry.at })
  return dehydrate(client)
}

describe('what is kept for reading offline', () => {
  it('is an allowlist: the diary, the bell, and who is signed in', () => {
    expect(isCacheable(['appointments', {}])).toBe(true)
    expect(isCacheable(['me'])).toBe(true)
    expect(isCacheable(['notifications', {}])).toBe(true)
  })

  it('never a chart, a note, a document list, a prescription or a bill', () => {
    // A device holds PHI at rest, and the less of it the better.
    for (const key of [
      ['patients', 'p1'],
      ['patients', { treatedByMe: true }],
      ['encounters', 'e1'],
      ['files', {}],
      ['prescriptions', {}],
      ['billing', 'statement', 'p1'],
      ['tickets', {}],
    ]) {
      expect(isCacheable(key)).toBe(false)
    }
  })

  it('stops being shown after a day, and when the clock has moved backwards', () => {
    const now = Date.now()
    expect(isUsable({ fetchedAt: now - 1000 }, now)).toBe(true)
    expect(isUsable({ fetchedAt: now - MAX_AGE_MS - 1 }, now)).toBe(false)
    expect(isUsable({ fetchedAt: now + 60_000 }, now)).toBe(false)
    expect(isUsable({ fetchedAt: Number.NaN }, now)).toBe(false)
  })

  it('filters a whole cache down to what may be kept and shown', () => {
    const now = Date.now()
    const state = stateWith([
      { key: ['appointments', { patientId: 'p1' }], data: [{ id: 'a1' }], at: now - 1000 },
      { key: ['encounters', 'e1'], data: { id: 'e1' }, at: now - 1000 },
      { key: ['notifications', {}], data: { items: [] }, at: now - MAX_AGE_MS - 5000 },
    ])
    expect(restorable(state, now).queries.map((query) => query.queryKey[0])).toEqual([
      'appointments',
    ])
  })

  it('knows whose reads they are only from the session itself', () => {
    const now = Date.now()
    expect(keptUser(stateWith([{ key: ['me'], data: user('u7'), at: now }]))?.id).toBe('u7')
    // A permissions list is under `me` too, and is not a person.
    expect(
      keptUser(stateWith([{ key: ['me', 'permissions'], data: { id: 'x' }, at: now }])),
    ).toBeNull()
    expect(keptUser(stateWith([{ key: ['me'], data: { id: 'no clinic' }, at: now }]))).toBeNull()
  })
})

describe('the offline store', () => {
  it('round-trips what may be kept, for its owner', async () => {
    const vault = memoryVault()
    const store = createOfflineStore(vault)
    const now = Date.now()
    await store.save(
      'u1',
      stateWith([
        { key: ['appointments', {}], data: [{ id: 'a1' }], at: now },
        { key: ['files', {}], data: [{ id: 'f1' }], at: now },
      ]),
    )

    // Only the allowlisted read reaches storage at all.
    expect(vault.held).not.toContain('f1')
    const kept = await store.load()
    expect(kept?.ownerId).toBe('u1')
    expect(kept?.state.queries.map((query) => query.queryKey[0])).toEqual(['appointments'])
  })

  it('treats a vault that will not decrypt as a miss, and destroys it, rather than crashing', async () => {
    // A restored backup, a wiped keychain: launching with no signal is the worst time to throw.
    const vault = memoryVault()
    vault.held = 'ciphertext'
    vault.failRead = true
    expect(await createOfflineStore(vault).load()).toBeNull()
    expect(vault.destroyed).toBe(1)
  })

  it('treats corruption and an older format as a miss too', async () => {
    for (const held of [
      'not json',
      JSON.stringify({ v: 0, ownerId: 'u1', savedAt: 1, state: { queries: [] } }),
    ]) {
      const vault = memoryVault()
      vault.held = held
      expect(await createOfflineStore(vault).load()).toBeNull()
      expect(vault.destroyed).toBe(1)
    }
  })

  it('shows nothing that has gone stale since it was saved', async () => {
    const vault = memoryVault()
    let clock = 1_000_000_000_000
    const store = createOfflineStore(vault, () => clock)
    await store.save('u1', stateWith([{ key: ['me'], data: user(), at: clock }]))
    clock += MAX_AGE_MS + 1
    expect(await store.load()).toBeNull()
  })
})

describe('launching the app', () => {
  const kept = (ownerId: string, withUser = true): KeptReads => ({
    ownerId,
    savedAt: Date.now(),
    state: stateWith(withUser ? [{ key: ['me'], data: user(ownerId), at: Date.now() }] : []),
  })

  it('signs out a phone with no session, and drops anything left behind', () => {
    expect(decideLaunch({ hasTokens: false, whoAmI: null, kept: kept('u1') })).toEqual({
      status: 'signedOut',
      reason: 'never',
      discardKept: true,
    })
  })

  it('signs in when the server says so, and keeps the reads only if they are this person’s', () => {
    const mine = decideLaunch({
      hasTokens: true,
      whoAmI: { ok: true, user: user('u1') },
      kept: kept('u1'),
    })
    expect(mine).toMatchObject({
      status: 'signedIn',
      offline: false,
      adoptKept: true,
      discardKept: false,
    })

    // The phone changed hands between launches.
    const theirs = decideLaunch({
      hasTokens: true,
      whoAmI: { ok: true, user: user('u2') },
      kept: kept('u1'),
    })
    expect(theirs).toMatchObject({ status: 'signedIn', adoptKept: false, discardKept: true })
  })

  /**
   * The first version sent a person with no signal to the sign-in screen — which they could not
   * complete either — on exactly the launch the offline cache exists for.
   */
  it('opens offline from what was kept when the server cannot be reached', () => {
    const outcome = decideLaunch({
      hasTokens: true,
      whoAmI: { ok: false, transient: true, code: 'NETWORK_UNREACHABLE' },
      kept: kept('u1'),
    })
    expect(outcome).toMatchObject({ status: 'signedIn', offline: true, adoptKept: true })
  })

  it('says the clinic cannot be reached — not "signed out" — when nothing was kept', () => {
    for (const nothing of [null, kept('u1', false)]) {
      expect(
        decideLaunch({
          hasTokens: true,
          whoAmI: { ok: false, transient: true, code: 'NETWORK_UNREACHABLE' },
          kept: nothing,
        }),
      ).toEqual({ status: 'unreachable', reason: 'network' })
    }
  })

  it('signs out a session the server refused, and drops its reads', () => {
    expect(
      decideLaunch({
        hasTokens: true,
        whoAmI: { ok: false, transient: false, code: 'UNAUTHENTICATED' },
        kept: kept('u1'),
      }),
    ).toEqual({ status: 'signedOut', reason: 'expired', discardKept: true })
  })

  it('does not sign out an app that is merely out of date', () => {
    // Signing in again would fail the same way; the person needs an update, not a password.
    expect(
      decideLaunch({
        hasTokens: true,
        whoAmI: { ok: false, transient: false, code: 'CONTRACT_MISMATCH' },
        kept: null,
      }),
    ).toEqual({ status: 'unreachable', reason: 'outdated' })
  })
})

/**
 * The first version had a store and never attached it to anything. These drive the attachment
 * through a real QueryClient.
 */
describe('the offline session', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps what a screen loads, and not what it should not', async () => {
    vi.useFakeTimers()
    const client = new QueryClient()
    const vault = memoryVault()
    const session = createOfflineSession(client, createOfflineStore(vault), { throttleMs: 1000 })
    session.begin(user('u1'))

    await client.fetchQuery({
      queryKey: ['appointments', { aroundToday: 60 }],
      queryFn: async () => [{ id: 'a1' }],
    })
    await client.fetchQuery({
      queryKey: ['encounters', 'e1'],
      queryFn: async () => ({ note: 'secret' }),
    })
    await vi.advanceTimersByTimeAsync(1000)
    await session.flush()

    expect(vault.held).toContain('a1')
    expect(vault.held).not.toContain('secret')
    const kept = await createOfflineStore(vault).load()
    expect(kept?.ownerId).toBe('u1')
    expect(keptUser(kept!.state)?.id).toBe('u1')
  })

  it('puts kept reads back, so the first screen renders before the network answers', async () => {
    const vault = memoryVault()
    const first = new QueryClient()
    const writer = createOfflineSession(first, createOfflineStore(vault))
    writer.begin(user('u1'))
    first.setQueryData(['appointments', { aroundToday: 60 }], [{ id: 'a1' }])
    await writer.flush()

    const second = new QueryClient()
    const reader = createOfflineSession(second, createOfflineStore(vault))
    const kept = await reader.load()
    reader.adopt(kept!)
    expect(second.getQueryData(['appointments', { aroundToday: 60 }])).toEqual([{ id: 'a1' }])
  })

  it('removes everything on sign-out, and a write already scheduled does not bring it back', async () => {
    vi.useFakeTimers()
    const client = new QueryClient()
    const vault = memoryVault()
    const session = createOfflineSession(client, createOfflineStore(vault), { throttleMs: 1000 })
    session.begin(user('u1'))
    await client.fetchQuery({
      queryKey: ['notifications', {}],
      queryFn: async () => ({ items: [] }),
    })

    await session.end()
    await vi.advanceTimersByTimeAsync(5000)

    expect(vault.held).toBeNull()
    expect(client.getQueryData(['notifications', {}])).toBeUndefined()
    expect(client.getQueryData(['me'])).toBeUndefined()
  })

  it('forgets the previous person when a different one begins', () => {
    const client = new QueryClient()
    const session = createOfflineSession(client, createOfflineStore(memoryVault()))
    session.begin(user('u1'))
    client.setQueryData(['appointments', {}], [{ id: 'theirs' }])

    session.begin(user('u2'))
    expect(client.getQueryData(['appointments', {}])).toBeUndefined()
    expect((client.getQueryData(['me']) as SessionUser).id).toBe('u2')
  })
})

describe('UTF-8 for the vault', () => {
  it('matches the platform encoder for every script a patient record holds', () => {
    for (const text of ['Karam', 'كرم', 'Ελένη', '見る', 'Dr 👩‍⚕️', '']) {
      expect([...encodeUtf8(text)]).toEqual([...new TextEncoder().encode(text)])
      expect(decodeUtf8(encodeUtf8(text))).toBe(text)
    }
  })
})
