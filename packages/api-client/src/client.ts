import { ApiErrorBody, ResponseMeta } from '@clinic/contracts'
import type { z } from 'zod'
import { ApiError, ContractMismatchError } from './errors'
import { cookieTokenStore, isNearlyExpired, type StoredTokens, type TokenStore } from './tokens'

/**
 * The typed fetch client both apps use (section 9.1).
 *
 * One client, two transports: the browser sends cookies it cannot read, the device sends a Bearer
 * header from secure storage. Everything above this line — hooks, cache keys, screens — is
 * identical, which is the actual test of whether §9 was implemented honestly rather than merely
 * written down.
 *
 * ## Refreshing is single-flight, and that is not an optimisation
 *
 * A phone coming back from the background fires every visible query at once. If each one reacted
 * to its own 401 by refreshing, twelve refreshes would race — and refresh tokens **rotate**, so
 * eleven of them would present a token the server has just retired. The server's reuse-detection
 * window treats near-simultaneous reuse as concurrency rather than theft, but leaning on that is
 * relying on a grace period to cover a bug. One refresh, shared by everybody waiting, has no such
 * question: the browser gets the same behaviour for free.
 *
 * ## Responses are validated against the contract
 *
 * A web build is never older than the server it talks to. **An app from a store can be months
 * older**, and a field the server stopped sending becomes `undefined` three components deep,
 * where it reads as a rendering bug rather than as version skew. Parsing the payload at the
 * boundary turns that into one clear error naming the endpoint. It is not free, so it can be
 * switched off — but the default is the safe one, because the case it guards is the one nobody
 * can reproduce.
 */

export interface ClientOptions {
  /** Absolute for the device (`https://clinic.example`); empty for the browser's own origin. */
  baseUrl?: string
  tokens?: TokenStore
  /** Injected so tests need no network and React Native can supply its own. */
  fetch?: typeof fetch
  /**
   * Called whenever the session changes — refreshed, replaced, or ended (`null`).
   *
   * How an app learns it has been signed out without every screen polling for it.
   */
  onSessionChanged?: (tokens: StoredTokens | null) => void
  /** Off only where the payload is large and the client and server ship together. */
  validateResponses?: boolean
  /** Overridable so a test can move time without waiting. */
  now?: () => Date
}

export interface RequestOptions<TResponse extends z.ZodTypeAny | undefined> {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  query?: Record<string, string | number | boolean | null | undefined>
  /** The contract the `data` field is parsed against. */
  schema?: TResponse
  /** For a POST that creates a booking or moves money (section 9.2). */
  idempotencyKey?: string
  signal?: AbortSignal
  /** Auth endpoints must not try to refresh: that is what they are for. */
  skipRefresh?: boolean
}

/**
 * Why a refresh ended. The distinction between "refused" and "unreachable" is the whole reason
 * this is a union rather than a nullable token.
 */
export type RefreshOutcome =
  | { outcome: 'refreshed'; tokens: StoredTokens | null }
  | { outcome: 'rejected' }
  | { outcome: 'unreachable' }

export interface Paged<T> {
  items: T[]
  nextCursor: string | null
  hasMore: boolean
}

export type ApiClient = ReturnType<typeof createClient>

export function createClient(options: ClientOptions = {}) {
  const baseUrl = (options.baseUrl ?? '').replace(/\/$/, '')
  const store = options.tokens ?? cookieTokenStore()
  const doFetch = options.fetch ?? globalThis.fetch
  const validate = options.validateResponses ?? true
  const now = options.now ?? (() => new Date())

  /** The refresh in flight, if any. Everybody who needs one awaits this same promise. */
  let refreshing: Promise<RefreshOutcome> | null = null

  function url(path: string, query?: RequestOptions<undefined>['query']): string {
    const search = new URLSearchParams()
    for (const [key, value] of Object.entries(query ?? {})) {
      // An absent filter is absent, not the string "undefined" — which the server would
      // dutifully parse and refuse.
      if (value === undefined || value === null || value === '') continue
      search.set(key, String(value))
    }
    const suffix = search.size > 0 ? `?${search.toString()}` : ''
    return `${baseUrl}${path}${suffix}`
  }

  async function authHeaders(): Promise<Record<string, string>> {
    if (store.transport === 'cookie') return {}
    const tokens = await store.read()
    return tokens ? { authorization: `Bearer ${tokens.accessToken}` } : {}
  }

  /**
   * Exchanges the refresh token for a new pair, once, however many callers want one.
   *
   * **The three outcomes are genuinely different and must not be collapsed.** "The server refused
   * this token" ends the session; "the server could not be reached" does not. Returning a bare
   * `null` for both signs somebody out every time they walk into a basement — which is precisely
   * the bug the test for this caught, and precisely the sort of thing that is reported as "the app
   * keeps logging me out" and never reproduces at a desk.
   */
  async function refreshSession(): Promise<RefreshOutcome> {
    refreshing ??= (async () => {
      try {
        const current = await store.read()
        // The browser's refresh token is in a cookie it cannot read; the server finds it itself.
        const body =
          store.transport === 'bearer'
            ? { refreshToken: current?.refreshToken, tokenDelivery: 'body' as const }
            : { tokenDelivery: 'cookie' as const }

        // Nothing to present. Not a failure to reach anybody — there is simply no session.
        if (store.transport === 'bearer' && !current?.refreshToken) return { outcome: 'rejected' }

        const response = await doFetch(url('/api/v1/auth/refresh'), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          credentials: store.transport === 'cookie' ? 'same-origin' : 'omit',
        })

        if (!response.ok) {
          await store.clear()
          options.onSessionChanged?.(null)
          return { outcome: 'rejected' }
        }

        const payload = (await response.json()) as { data?: { tokens?: StoredTokens } }
        const issued = payload.data?.tokens ?? null
        if (issued) await store.write(issued)
        options.onSessionChanged?.(issued)
        return { outcome: 'refreshed', tokens: issued }
      } catch {
        // The phone is in a lift. Leave the tokens alone so the next attempt can use them.
        return { outcome: 'unreachable' }
      } finally {
        refreshing = null
      }
    })()

    return refreshing
  }

  async function send(path: string, options_: RequestOptions<z.ZodTypeAny | undefined>) {
    const headers: Record<string, string> = {
      accept: 'application/json',
      // A header rather than fetch's `cache` option: React Native's fetch has no such option, and
      // a client shared by a browser and a device cannot use one platform's extras. Every API
      // response is already `no-store` from the server, so this only restates the intent.
      'cache-control': 'no-cache',
    }
    if (options_.body !== undefined) headers['content-type'] = 'application/json'
    if (options_.idempotencyKey) headers['idempotency-key'] = options_.idempotencyKey
    Object.assign(headers, await authHeaders())

    return doFetch(url(path, options_.query), {
      method: options_.method ?? 'GET',
      headers,
      body: options_.body === undefined ? undefined : JSON.stringify(options_.body),
      credentials: store.transport === 'cookie' ? 'same-origin' : 'omit',
      signal: options_.signal,
    })
  }

  async function request<TSchema extends z.ZodTypeAny>(
    path: string,
    options_: RequestOptions<TSchema> & { schema: TSchema },
  ): Promise<z.infer<TSchema>>
  async function request(path: string, options_?: RequestOptions<undefined>): Promise<unknown>
  async function request(
    path: string,
    options_: RequestOptions<z.ZodTypeAny | undefined> = {},
  ): Promise<unknown> {
    const { value } = await requestWithMeta(path, options_)
    return value
  }

  /**
   * The one place a request actually happens. Everything else is a typed wrapper over this.
   *
   * The meta comes back with the value because cursor pagination lives there: a caller that
   * wanted the next page would otherwise have to reach into the envelope the client just unwrapped.
   */
  async function requestWithMeta(
    path: string,
    options_: RequestOptions<z.ZodTypeAny | undefined> = {},
  ): Promise<{ value: unknown; meta: ResponseMeta | null }> {
    // Pre-emptive: refreshing while the app is already waiting for the network costs nothing,
    // whereas discovering expiry through a failed round trip costs a whole one.
    if (!options_.skipRefresh && store.transport === 'bearer') {
      const tokens = await store.read()
      if (tokens && isNearlyExpired(tokens, now())) await refreshSession()
    }

    let response = await sendSafely(path, options_)
    let payload = await readEnvelope(response)

    const expired =
      response.status === 401 &&
      !options_.skipRefresh &&
      // Only a token that has run out is worth a retry. A revoked session or wrong credentials
      // would fail identically, and retrying would just double the work before the same answer.
      (payload.error?.code === 'TOKEN_EXPIRED' || store.transport === 'cookie')

    let refresh: RefreshOutcome | null = null
    if (expired) {
      refresh = await refreshSession()
      if (refresh.outcome === 'refreshed') {
        response = await sendSafely(path, options_)
        payload = await readEnvelope(response)
      }
    }

    const meta = ResponseMeta.safeParse(payload.meta)
    const requestId = meta.success ? meta.data.requestId : null

    if (!response.ok) {
      // Cleared only when the session is genuinely over. A 401 we could not follow up on —
      // because the refresh never reached the server — leaves the tokens where they are, so
      // walking back into signal resumes rather than restarts.
      if (response.status === 401 && refresh?.outcome !== 'unreachable') {
        await store.clear()
        options.onSessionChanged?.(null)
      }
      throw toApiError(response, payload, requestId)
    }

    const schema = options_.schema
    if (!schema || !validate) {
      return { value: payload.data, meta: meta.success ? meta.data : null }
    }

    const parsed = schema.safeParse(payload.data)
    if (!parsed.success) {
      throw new ContractMismatchError(
        path,
        parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
        requestId,
      )
    }
    return { value: parsed.data, meta: meta.success ? meta.data : null }
  }

  /** A transport failure becomes an ApiError with status 0, so callers have one thing to catch. */
  async function sendSafely(
    path: string,
    options_: RequestOptions<z.ZodTypeAny | undefined>,
  ): Promise<Response> {
    try {
      return await send(path, options_)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error
      throw new ApiError(
        0,
        'NETWORK_UNREACHABLE',
        error instanceof Error ? error.message : 'The server could not be reached.',
      )
    }
  }

  /** A collection endpoint, with the cursor the envelope carried. */
  async function paged<TSchema extends z.ZodTypeAny>(
    path: string,
    options_: RequestOptions<TSchema> & { schema: TSchema },
  ): Promise<Paged<z.infer<TSchema>>> {
    const { value, meta } = await requestWithMeta(path, {
      ...options_,
      schema: options_.schema.array(),
    })
    return {
      items: value as z.infer<TSchema>[],
      nextCursor: meta?.nextCursor ?? null,
      hasMore: meta?.hasMore ?? meta?.nextCursor != null,
    }
  }

  return { request, requestWithMeta, paged, refreshSession, tokens: store, baseUrl }
}

interface Envelope {
  data?: unknown
  error?: { code?: string; message?: string; details?: Array<{ field: string; issue: string }> }
  meta?: unknown
}

/** A body that is not JSON is a proxy error page or a gateway timeout, not a contract breach. */
async function readEnvelope(response: Response): Promise<Envelope> {
  try {
    return ((await response.json()) as Envelope | null) ?? {}
  } catch {
    return {}
  }
}

function toApiError(response: Response, payload: Envelope, requestId: string | null): ApiError {
  const parsed = ApiErrorBody.safeParse(payload.error)
  const retryAfter = Number(response.headers.get('retry-after'))

  return new ApiError(
    response.status,
    parsed.success ? parsed.data.code : fallbackCode(response.status),
    parsed.success ? parsed.data.message : `The request failed (${response.status}).`,
    parsed.success ? (parsed.data.details ?? []) : [],
    Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null,
    requestId,
  )
}

const fallbackCode = (status: number): string =>
  status >= 500 ? 'INTERNAL_ERROR' : status === 404 ? 'NOT_FOUND' : 'REQUEST_FAILED'
