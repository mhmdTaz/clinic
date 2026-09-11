import { NextResponse, type NextRequest } from 'next/server'
import type { z } from 'zod'
import { env } from '@clinic/config'
import { issueCode, issuePath } from '@clinic/contracts'
import {
  UnauthenticatedError,
  ValidationError,
  isDomainError,
  runWithContext,
  type RequestContext,
} from '@clinic/core'
import { assertCan, type Actor, type PermissionKey } from '@clinic/core/access'
import {
  authenticateAccessToken,
  type IssuedAccessToken,
  type RequestMeta,
} from '@clinic/core/session'
import {
  ACCESS_COOKIE,
  SESSION_HINT_COOKIE,
  clearSessionCookies,
  setAccessCookie,
} from '@/lib/auth/cookies'
import { requestMetaFrom } from '@/lib/auth/request-meta'
import { CrossSiteRequestError, PayloadTooLargeError } from './errors'

/**
 * The one place that knows about HTTP (section 6.1). In order, it:
 *   1. refuses cross-site state-changing requests (16.1)
 *   2. authenticates a bearer token or the session cookie — the same path for both (9.1)
 *   3. opens the request context that audit capture reads (11.2)
 *   4. applies the coarse permission gate, which audits a denial (7.6)
 *   5. validates the body and query against the shared contracts
 *   6. shapes the envelope and maps domain errors to status codes (9.2, 13.2)
 *
 * Route handlers stay thin enough to be obviously correct, and the mobile app gets
 * identical behaviour because it goes through exactly the same wrapper.
 */
type Schema = z.ZodTypeAny
type Output<S> = S extends Schema ? z.output<S> : undefined

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const MAX_BODY_BYTES = 64 * 1024

export type Transport = 'cookie' | 'bearer' | 'none'

export interface ApiContext<TActor, TBody, TQuery> {
  request: NextRequest
  requestId: string
  actor: TActor
  body: TBody
  query: TQuery
  params: Record<string, string>
  meta: RequestMeta
  /** How the caller authenticated: browsers use cookies, the mobile app bearer tokens. */
  transport: Transport
}

export interface ApiResult<T> {
  status?: number
  data: T
  /** Collection pagination (section 9.2), carried in the envelope's meta beside the request id. */
  meta?: { nextCursor?: string | null; hasMore?: boolean }
  /** Cookie changes and extra headers, applied to the final response. */
  respond?: (response: NextResponse) => void
}

interface Options<B extends Schema | undefined, Q extends Schema | undefined> {
  permission?: PermissionKey
  body?: B
  query?: Q
}

type RouteHandler = (
  request: NextRequest,
  context: { params: Promise<Record<string, string>> },
) => Promise<NextResponse>

export function withApi<
  T,
  B extends Schema | undefined = undefined,
  Q extends Schema | undefined = undefined,
>(
  options: Options<B, Q> & { auth?: 'required' },
  handler: (context: ApiContext<Actor, Output<B>, Output<Q>>) => Promise<ApiResult<T>>,
): RouteHandler
export function withApi<
  T,
  B extends Schema | undefined = undefined,
  Q extends Schema | undefined = undefined,
>(
  options: Options<B, Q> & { auth: 'optional' | 'none' },
  handler: (context: ApiContext<Actor | null, Output<B>, Output<Q>>) => Promise<ApiResult<T>>,
): RouteHandler
export function withApi(
  options: Options<Schema | undefined, Schema | undefined> & {
    auth?: 'required' | 'optional' | 'none'
  },
  // `never` accepts every overload's handler; the overloads above carry the real types.
  handler: (context: never) => Promise<ApiResult<unknown>>,
): RouteHandler {
  const auth = options.auth ?? 'required'

  return async (request, routeContext) => {
    const requestId = request.headers.get('x-request-id') ?? crypto.randomUUID()
    const headers = { 'x-request-id': requestId, 'cache-control': 'no-store' }
    const hadSessionCookie =
      request.cookies.has(ACCESS_COOKIE) || request.cookies.has(SESSION_HINT_COOKIE)
    const meta = requestMetaFrom(request.headers)

    try {
      if (UNSAFE_METHODS.has(request.method)) assertSameOrigin(request)

      const { token, transport } = accessTokenOf(request)
      let actor: Actor | null = null
      let reissued: IssuedAccessToken | null = null

      if (auth !== 'none' && token) {
        try {
          const authentication = await authenticateAccessToken(token)
          actor = authentication.actor
          reissued = authentication.reissued
        } catch (error) {
          // Optional routes (sign-out) carry on anonymously with an expired or ended token.
          if (auth === 'required' || !isDomainError(error)) throw error
        }
      }
      if (auth === 'required' && !actor) throw new UnauthenticatedError()

      const context: RequestContext = {
        requestId,
        actorId: actor?.userId,
        actorType: actor ? actor.kind : 'ANONYMOUS',
        actorLabel: actor?.displayName,
        actorRoles: actor?.roleKeys ?? [],
        clinicId: actor?.clinicId,
        ipAddress: meta.ipAddress ?? undefined,
        userAgent: meta.userAgent ?? undefined,
      }

      const result = await runWithContext(context, async () => {
        if (options.permission) {
          if (!actor) throw new UnauthenticatedError()
          await assertCan(actor, options.permission)
        }
        const context: ApiContext<Actor | null, unknown, unknown> = {
          request,
          requestId,
          actor,
          meta,
          transport: actor ? transport : 'none',
          body: options.body ? await readBody(request, options.body) : undefined,
          query: options.query ? readQuery(request, options.query) : undefined,
          params: (await routeContext?.params) ?? {},
        }
        return handler(context as never)
      })

      const response = NextResponse.json(
        { data: result.data, meta: { requestId, ...result.meta } },
        { status: result.status ?? 200, headers },
      )
      // Grants changed mid-session: the replacement token goes back in this response (7.7).
      if (reissued && transport === 'cookie') setAccessCookie(response, reissued)
      result.respond?.(response)
      return response
    } catch (error) {
      return errorResponse(error, requestId, headers, hadSessionCookie)
    }
  }
}

function accessTokenOf(request: NextRequest): { token: string | null; transport: Transport } {
  const authorization = request.headers.get('authorization')
  if (authorization?.toLowerCase().startsWith('bearer ')) {
    return { token: authorization.slice(7).trim() || null, transport: 'bearer' }
  }
  const cookie = request.cookies.get(ACCESS_COOKIE)?.value
  return cookie ? { token: cookie, transport: 'cookie' } : { token: null, transport: 'none' }
}

/**
 * Browsers always send Origin on a cross-site state-changing request, so a mismatch is
 * refused outright — including the literal "null" some sandboxed contexts send. A request
 * with no Origin at all comes from a non-browser client such as the mobile app, which
 * carries no ambient cookie authority to abuse.
 */
function assertSameOrigin(request: NextRequest): void {
  const origin = request.headers.get('origin')
  if (origin === null) return
  if (origin !== new URL(env().APP_URL).origin) throw new CrossSiteRequestError()
}

async function readBody<S extends Schema>(request: NextRequest, schema: S): Promise<z.output<S>> {
  if (Number(request.headers.get('content-length') ?? '0') > MAX_BODY_BYTES) {
    throw new PayloadTooLargeError(MAX_BODY_BYTES)
  }
  const text = await request.text()
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    throw new PayloadTooLargeError(MAX_BODY_BYTES)
  }

  let raw: unknown = {}
  if (text.trim() !== '') {
    try {
      raw = JSON.parse(text)
    } catch {
      throw new ValidationError('The request body is not valid JSON.', [
        { field: '(body)', issue: 'INVALID_JSON' },
      ])
    }
  }
  return parse(schema, raw)
}

function readQuery<S extends Schema>(request: NextRequest, schema: S): z.output<S> {
  return parse(schema, Object.fromEntries(request.nextUrl.searchParams))
}

/**
 * Parsing builds a new object holding only declared fields, so an unexpected key — a
 * "$ne" smuggled in to become a query operator, say — never reaches a use case (16.1).
 *
 * Each issue is reported as a stable code, the same one the forms compute client-side, so
 * the message is translated at the edge rather than shipped in English (13.6).
 */
function parse<S extends Schema>(schema: S, raw: unknown): z.output<S> {
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    throw new ValidationError(
      'Some fields are invalid.',
      parsed.error.issues.map((issue) => ({ field: issuePath(issue), issue: issueCode(issue) })),
    )
  }
  return parsed.data
}

function errorResponse(
  error: unknown,
  requestId: string,
  headers: Record<string, string>,
  hadSessionCookie: boolean,
): NextResponse {
  if (isDomainError(error)) {
    const response = NextResponse.json(
      {
        error: { code: error.code, message: error.message, details: error.details },
        meta: { requestId },
      },
      { status: error.status, headers },
    )
    const retryAfter = (error as { retryAfterSeconds?: unknown }).retryAfterSeconds
    if (typeof retryAfter === 'number' && retryAfter > 0) {
      response.headers.set('retry-after', String(retryAfter))
    }
    // An ended session is removed from the browser, so pages stop presenting a signature
    // the server no longer honours.
    if (error.code === 'UNAUTHENTICATED' && hadSessionCookie) clearSessionCookies(response)
    return response
  }

  // A 500 never leaks a stack trace or a driver message; it carries the id support needs.
  console.error(`[${requestId}]`, error)
  return NextResponse.json(
    {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Something went wrong. Quote the request id when reporting this.',
      },
      meta: { requestId },
    },
    { status: 500, headers },
  )
}
