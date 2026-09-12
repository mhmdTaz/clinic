import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createClient } from '../client'
import { ApiError, ContractMismatchError } from '../errors'
import { isNearlyExpired, memoryTokenStore, secureTokenStore, type StoredTokens } from '../tokens'

const tokens = (over: Partial<StoredTokens> = {}): StoredTokens => ({
  accessToken: 'access-1',
  accessTokenExpiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
  refreshToken: 'refresh-1',
  refreshTokenExpiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
  ...over,
})

/** A fetch double that answers from a queue and records what it was asked. */
function stubFetch(
  answers: Array<{ status?: number; body?: unknown; headers?: Record<string, string> }>,
) {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const remaining = [...answers]

  const fetchStub = vi.fn(async (input: unknown, init: RequestInit = {}) => {
    calls.push({ url: String(input), init })
    const answer = remaining.shift() ?? { status: 500, body: {} }
    return {
      ok: (answer.status ?? 200) < 400,
      status: answer.status ?? 200,
      headers: { get: (name: string) => answer.headers?.[name] ?? null },
      json: async () => answer.body ?? {},
    } as unknown as Response
  })

  return { fetchStub: fetchStub as unknown as typeof fetch, calls }
}

const envelope = (data: unknown, meta: Record<string, unknown> = {}) => ({
  data,
  meta: { requestId: 'req-1', ...meta },
})

describe('the request pipeline', () => {
  it('sends a Bearer header from the store, and no cookies', async () => {
    const { fetchStub, calls } = stubFetch([{ body: envelope({ ok: true }) }])
    const client = createClient({
      baseUrl: 'https://clinic.test',
      tokens: memoryTokenStore(tokens()),
      fetch: fetchStub,
    })

    await client.request('/api/v1/me')

    expect(calls[0]!.url).toBe('https://clinic.test/api/v1/me')
    const headers = calls[0]!.init.headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer access-1')
    // A device has no cookie worth sending, and sending one would be a CSRF surface.
    expect(calls[0]!.init.credentials).toBe('omit')
  })

  it('sends cookies and no header for a browser', async () => {
    const { fetchStub, calls } = stubFetch([{ body: envelope({ ok: true }) }])
    const client = createClient({ fetch: fetchStub })

    await client.request('/api/v1/me')

    const headers = calls[0]!.init.headers as Record<string, string>
    expect(headers.authorization).toBeUndefined()
    expect(calls[0]!.init.credentials).toBe('same-origin')
  })

  it('drops absent query parameters rather than sending "undefined"', async () => {
    const { fetchStub, calls } = stubFetch([{ body: envelope([]) }])
    const client = createClient({ fetch: fetchStub })

    await client.request('/api/v1/appointments', {
      query: { status: undefined, patientId: null, q: '', limit: 25 },
    })

    expect(calls[0]!.url).toBe('/api/v1/appointments?limit=25')
  })

  it('passes an idempotency key through, which a retried booking depends on', async () => {
    const { fetchStub, calls } = stubFetch([{ body: envelope({ id: 'a1' }) }])
    const client = createClient({ fetch: fetchStub })

    await client.request('/api/v1/me/appointments', {
      method: 'POST',
      body: {},
      idempotencyKey: 'key-1',
    })

    expect((calls[0]!.init.headers as Record<string, string>)['idempotency-key']).toBe('key-1')
  })
})

describe('errors', () => {
  it('carries the code, the field issues and the request id', async () => {
    const { fetchStub } = stubFetch([
      {
        status: 422,
        body: {
          error: {
            code: 'VALIDATION_FAILED',
            message: 'Some fields are invalid.',
            details: [{ field: 'email', issue: 'INVALID_EMAIL' }],
          },
          meta: { requestId: 'req-9' },
        },
      },
    ])
    const client = createClient({ fetch: fetchStub })

    const error = await client.request('/api/v1/me').catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ApiError)
    const api = error as ApiError
    expect(api.code).toBe('VALIDATION_FAILED')
    expect(api.requestId).toBe('req-9')
    expect(api.fieldErrors()).toEqual({ email: 'INVALID_EMAIL' })
  })

  it('separates what is worth retrying from what is not', async () => {
    const transient = new ApiError(503, 'INTERNAL_ERROR', '')
    const rateLimited = new ApiError(429, 'RATE_LIMITED', '')
    const refused = new ApiError(403, 'FORBIDDEN', '')

    expect(transient.isTransient).toBe(true)
    expect(rateLimited.isTransient).toBe(true)
    // Retrying a refusal fails identically and wastes a round trip on a phone.
    expect(refused.isTransient).toBe(false)
  })

  it('turns an unreachable server into an ApiError, not a raw TypeError', async () => {
    const fetchStub = vi.fn(async () => {
      throw new TypeError('Network request failed')
    }) as unknown as typeof fetch
    const client = createClient({ fetch: fetchStub })

    const error = await client.request('/api/v1/me').catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).code).toBe('NETWORK_UNREACHABLE')
    expect((error as ApiError).isTransient).toBe(true)
  })

  it('reads retry-after, so a rate limit can be waited out rather than hammered', async () => {
    const { fetchStub } = stubFetch([
      {
        status: 429,
        headers: { 'retry-after': '30' },
        body: { error: { code: 'RATE_LIMITED', message: 'Too many' }, meta: { requestId: 'r' } },
      },
    ])
    const client = createClient({ fetch: fetchStub })

    const error = (await client.request('/api/v1/me').catch((c: unknown) => c)) as ApiError
    expect(error.retryAfterSeconds).toBe(30)
  })
})

describe('response validation', () => {
  const Shape = z.object({ id: z.string(), name: z.string() })

  it('returns the parsed value', async () => {
    const { fetchStub } = stubFetch([{ body: envelope({ id: 'p1', name: 'Rami' }) }])
    const client = createClient({ fetch: fetchStub })

    expect(await client.request('/api/v1/x', { schema: Shape })).toEqual({
      id: 'p1',
      name: 'Rami',
    })
  })

  it('names the endpoint when the server sends something else', async () => {
    // The version-skew case: an app from the store, a server that changed a field.
    const { fetchStub } = stubFetch([{ body: envelope({ id: 'p1' }) }])
    const client = createClient({ fetch: fetchStub })

    const error = await client
      .request('/api/v1/patients/p1', { schema: Shape })
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ContractMismatchError)
    const mismatch = error as ContractMismatchError
    expect(mismatch.path).toBe('/api/v1/patients/p1')
    expect(mismatch.issues.join()).toContain('name')
  })

  it('can be switched off where the payload is large and the versions ship together', async () => {
    const { fetchStub } = stubFetch([{ body: envelope({ id: 'p1' }) }])
    const client = createClient({ fetch: fetchStub, validateResponses: false })

    await expect(client.request('/api/v1/x', { schema: Shape })).resolves.toEqual({ id: 'p1' })
  })
})

describe('refreshing', () => {
  it('refreshes once for many requests that expire together', async () => {
    // The app coming back from the background: every visible query fires at once.
    const expired = {
      status: 401,
      body: { error: { code: 'TOKEN_EXPIRED', message: 'expired' }, meta: { requestId: 'r' } },
    }
    const { fetchStub, calls } = stubFetch([
      expired,
      expired,
      expired,
      { body: envelope({ tokens: tokens({ accessToken: 'access-2' }) }) },
      { body: envelope({ ok: 1 }) },
      { body: envelope({ ok: 2 }) },
      { body: envelope({ ok: 3 }) },
    ])
    const store = memoryTokenStore(tokens())
    const client = createClient({ fetch: fetchStub, tokens: store })

    await Promise.all([
      client.request('/api/v1/a'),
      client.request('/api/v1/b'),
      client.request('/api/v1/c'),
    ])

    // Exactly one. Refresh tokens rotate, so three would have presented a retired token twice.
    const refreshes = calls.filter((call) => call.url.includes('/auth/refresh'))
    expect(refreshes).toHaveLength(1)
    expect((await store.read())?.accessToken).toBe('access-2')
  })

  it('reports why a refresh ended, because the two reasons differ', async () => {
    const { fetchStub } = stubFetch([{ status: 401, body: { error: { code: 'UNAUTHENTICATED' } } }])
    const rejected = createClient({ fetch: fetchStub, tokens: memoryTokenStore(tokens()) })
    expect(await rejected.refreshSession()).toEqual({ outcome: 'rejected' })

    const offline = createClient({
      fetch: (async () => {
        throw new TypeError('Network request failed')
      }) as unknown as typeof fetch,
      tokens: memoryTokenStore(tokens()),
    })
    expect(await offline.refreshSession()).toEqual({ outcome: 'unreachable' })
  })

  it('refreshes before the request when the token is nearly out', async () => {
    const { fetchStub, calls } = stubFetch([
      { body: envelope({ tokens: tokens({ accessToken: 'access-2' }) }) },
      { body: envelope({ ok: true }) },
    ])
    const store = memoryTokenStore(tokens({ accessTokenExpiresAt: new Date().toISOString() }))
    const client = createClient({ fetch: fetchStub, tokens: store })

    await client.request('/api/v1/me')

    // The refresh happens first: a round trip that was going to fail is a round trip wasted.
    expect(calls[0]!.url).toContain('/auth/refresh')
    expect((calls[1]!.init.headers as Record<string, string>).authorization).toBe('Bearer access-2')
  })

  it('signs out when the refresh token is rejected', async () => {
    const changed = vi.fn()
    const { fetchStub } = stubFetch([
      {
        status: 401,
        body: { error: { code: 'TOKEN_EXPIRED', message: '' }, meta: { requestId: 'r' } },
      },
      { status: 401, body: { error: { code: 'UNAUTHENTICATED', message: '' } } },
    ])
    const store = memoryTokenStore(tokens())
    const client = createClient({ fetch: fetchStub, tokens: store, onSessionChanged: changed })

    await expect(client.request('/api/v1/me')).rejects.toBeInstanceOf(ApiError)
    expect(await store.read()).toBeNull()
    expect(changed).toHaveBeenCalledWith(null)
  })

  it('keeps the tokens when the refresh could not reach the server', async () => {
    // A phone in a lift is not a signed-out user, and clearing here would sign somebody out
    // every time they walked into a basement.
    let call = 0
    const fetchStub = vi.fn(async (input: unknown) => {
      call += 1
      if (String(input).includes('/auth/refresh')) throw new TypeError('Network request failed')
      return {
        ok: false,
        status: 401,
        headers: { get: () => null },
        json: async () => ({ error: { code: 'TOKEN_EXPIRED', message: '' } }),
      } as unknown as Response
    }) as unknown as typeof fetch

    const store = memoryTokenStore(tokens())
    const client = createClient({ fetch: fetchStub, tokens: store })

    await expect(client.request('/api/v1/me')).rejects.toBeInstanceOf(ApiError)
    expect(await store.read()).not.toBeNull()
    expect(call).toBeGreaterThan(1)
  })

  it('does not try to refresh on the auth endpoints themselves', async () => {
    const { fetchStub, calls } = stubFetch([
      { status: 401, body: { error: { code: 'TOKEN_EXPIRED', message: '' } } },
    ])
    const client = createClient({ fetch: fetchStub, tokens: memoryTokenStore(tokens()) })

    await expect(
      client.request('/api/v1/auth/login', { method: 'POST', body: {}, skipRefresh: true }),
    ).rejects.toBeInstanceOf(ApiError)

    expect(calls.filter((call) => call.url.includes('/auth/refresh'))).toHaveLength(0)
  })
})

describe('paging', () => {
  it('returns the items with the cursor the envelope carried', async () => {
    const { fetchStub } = stubFetch([
      { body: envelope([{ id: 'a' }, { id: 'b' }], { nextCursor: 'c-2', hasMore: true }) },
    ])
    const client = createClient({ fetch: fetchStub })

    const page = await client.paged('/api/v1/appointments', {
      schema: z.object({ id: z.string() }),
    })
    expect(page.items).toHaveLength(2)
    expect(page.nextCursor).toBe('c-2')
    expect(page.hasMore).toBe(true)
  })

  it('reports the end of a collection', async () => {
    const { fetchStub } = stubFetch([{ body: envelope([{ id: 'a' }]) }])
    const client = createClient({ fetch: fetchStub })

    const page = await client.paged('/api/v1/appointments', {
      schema: z.object({ id: z.string() }),
    })
    expect(page.nextCursor).toBeNull()
    expect(page.hasMore).toBe(false)
  })
})

describe('token storage', () => {
  it('treats corrupt secure storage as signed out, not as a crash on launch', async () => {
    const backing = new Map<string, string>([['clinic.session', 'not json']])
    const store = secureTokenStore({
      getItem: async (key) => backing.get(key) ?? null,
      setItem: async (key, value) => void backing.set(key, value),
      removeItem: async (key) => void backing.delete(key),
    })

    expect(await store.read()).toBeNull()
    expect(backing.has('clinic.session')).toBe(false)
  })

  it('round-trips a session', async () => {
    const backing = new Map<string, string>()
    const store = secureTokenStore({
      getItem: async (key) => backing.get(key) ?? null,
      setItem: async (key, value) => void backing.set(key, value),
      removeItem: async (key) => void backing.delete(key),
    })

    await store.write(tokens())
    expect((await store.read())?.accessToken).toBe('access-1')
    await store.clear()
    expect(await store.read()).toBeNull()
  })

  it('treats an unreadable expiry as expired rather than as valid forever', async () => {
    expect(isNearlyExpired(tokens({ accessTokenExpiresAt: 'nonsense' }), new Date())).toBe(true)
  })

  it('refreshes a minute early, to cover a device clock that runs fast', async () => {
    const now = new Date('2026-09-12T10:00:00Z')
    const inThirtySeconds = tokens({ accessTokenExpiresAt: '2026-09-12T10:00:30Z' })
    const inTenMinutes = tokens({ accessTokenExpiresAt: '2026-09-12T10:10:00Z' })

    expect(isNearlyExpired(inThirtySeconds, now)).toBe(true)
    expect(isNearlyExpired(inTenMinutes, now)).toBe(false)
  })
})
