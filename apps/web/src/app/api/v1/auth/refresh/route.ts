import { NextResponse, type NextRequest } from 'next/server'
import { env } from '@clinic/config'
import { RefreshRequest } from '@clinic/contracts'
import { UnauthenticatedError, isDomainError, runWithContext } from '@clinic/core'
import { refresh } from '@clinic/core/session'
import { sessionResult } from '@/lib/api/session-result'
import { withApi } from '@/lib/api/with-api'
import { REFRESH_COOKIE, clearSessionCookies, setSessionCookies } from '@/lib/auth/cookies'
import { requestMetaFrom } from '@/lib/auth/request-meta'
import { safeNextPath } from '@/lib/auth/safe-next'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** API refresh: the mobile app sends its token in the body, browsers rely on the cookie. */
export const POST = withApi(
  { auth: 'none', body: RefreshRequest },
  async ({ body, request, meta }) => {
    const token = body.refreshToken ?? request.cookies.get(REFRESH_COOKIE)?.value
    if (!token) throw new UnauthenticatedError()
    const session = await refresh({ refreshToken: token, meta })
    return sessionResult(session, body.refreshToken ? 'body' : body.tokenDelivery)
  },
)

/**
 * Browser refresh during page navigation. The middleware sends the browser here when its
 * access token has expired (a server component does too, if it expired mid-request); it renews
 * the cookies and returns the browser to where it was going, or clears them and asks it to sign
 * in again. Stale grants never come this way: server components authorise against the current
 * grants and TokenRenewal replaces the cookie (see lib/auth/server-session).
 */
export async function GET(request: NextRequest) {
  const next = safeNextPath(request.nextUrl.searchParams.get('next'))
  const toLogin = () => {
    const response = NextResponse.redirect(
      new URL(`/login?next=${encodeURIComponent(next)}&reason=ended`, env().APP_URL),
      303,
    )
    clearSessionCookies(response)
    return response
  }

  const token = request.cookies.get(REFRESH_COOKIE)?.value
  if (!token) return toLogin()

  const meta = requestMetaFrom(request.headers)
  try {
    const session = await runWithContext(
      {
        requestId: request.headers.get('x-request-id') ?? crypto.randomUUID(),
        actorType: 'ANONYMOUS',
        actorRoles: [],
        ipAddress: meta.ipAddress ?? undefined,
        userAgent: meta.userAgent ?? undefined,
      },
      () => refresh({ refreshToken: token, meta }),
    )
    const response = NextResponse.redirect(new URL(next, env().APP_URL), 303)
    setSessionCookies(response, session)
    return response
  } catch (error) {
    if (!isDomainError(error)) console.error('[auth] refresh failed unexpectedly', error)
    return toLogin()
  }
}
