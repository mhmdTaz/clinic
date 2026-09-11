import { NextResponse } from 'next/server'
import { isDomainError, runWithContext, type RequestContext } from '@clinic/core'
import type { ResponseMeta } from '@clinic/contracts'

/**
 * The one place that knows about HTTP (section 6.1).
 *
 * It opens the request context that audit capture reads, shapes the response
 * envelope, and maps domain errors to status codes. Route handlers stay thin enough
 * to be obviously correct; the mobile API gets identical behaviour for free because
 * it goes through the same wrapper.
 *
 * Phase 1 adds authentication and the coarse permission gate here.
 */
export interface ApiContext {
  requestId: string
}

type Handler<T> = (ctx: ApiContext) => Promise<{ status?: number; data: T }>

export function withApi<T>(handler: Handler<T>) {
  return async (request: Request): Promise<NextResponse> => {
    const requestId = request.headers.get('x-request-id') ?? crypto.randomUUID()
    const meta: ResponseMeta = { requestId }

    const context: RequestContext = {
      requestId,
      actorType: 'ANONYMOUS',
      actorRoles: [],
      ipAddress: request.headers.get('x-forwarded-for') ?? undefined,
      userAgent: request.headers.get('user-agent') ?? undefined,
    }

    try {
      const result = await runWithContext(context, () => handler({ requestId }))
      return NextResponse.json(
        { data: result.data, meta },
        { status: result.status ?? 200, headers: { 'x-request-id': requestId } },
      )
    } catch (error) {
      if (isDomainError(error)) {
        return NextResponse.json(
          {
            error: { code: error.code, message: error.message, details: error.details },
            meta,
          },
          { status: error.status, headers: { 'x-request-id': requestId } },
        )
      }

      // A 500 never leaks a stack trace or a driver message to the client; it returns
      // the requestId so support can find the trace (section 13.2).
      console.error(`[${requestId}]`, error)
      return NextResponse.json(
        {
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Something went wrong. Quote the request id when reporting this.',
          },
          meta,
        },
        { status: 500, headers: { 'x-request-id': requestId } },
      )
    }
  }
}
