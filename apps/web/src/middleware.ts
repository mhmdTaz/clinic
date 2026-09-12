import { NextResponse, type NextRequest } from 'next/server'
import { env } from '@clinic/config'
import { landingPath, verifyAccessToken } from '@clinic/core/edge'
import { ACCESS_COOKIE, SESSION_HINT_COOKIE } from '@/lib/auth/cookies'
import { buildSecurityHeaders } from '@/lib/security/csp'

/**
 * Deliberately thin (section 10.2): is there a valid session, and if not, can one be
 * refreshed? It never touches the database.
 *
 * Portal permissions are NOT checked here. Each portal's layout checks them with
 * assertCan, which is authoritative against current grants and records the denial in
 * the audit log — a redirect from middleware could do neither.
 *
 * It is also where the security headers are set (section 16.1), because the CSP carries a
 * **per-request nonce** and there is nowhere earlier to generate one. The nonce goes onto the
 * request as well as the response: Next reads it from the request's CSP header and stamps it onto
 * every script tag it renders, which is what makes a strict policy work without listing chunks.
 */
const PUBLIC_PAGES = ['/login', '/forgot-password', '/reset-password', '/accept-invite']

/** A misconfigured URL narrows the policy rather than failing the request. */
function originOf(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return ''
  }
}

function isPublicPage(pathname: string): boolean {
  return PUBLIC_PAGES.some((page) => pathname === page || pathname.startsWith(`${page}/`))
}

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl
  const requestId = request.headers.get('x-request-id') ?? crypto.randomUUID()
  const security = buildSecurityHeaders({
    isDevelopment: env().NODE_ENV !== 'production',
    // Files go straight from the browser to object storage on a presigned PUT (12.1), so the
    // policy has to name that origin or every upload fails with no visible error.
    storageOrigin: originOf(env().S3_ENDPOINT),
    appUrl: env().APP_URL,
  })

  /** Every response leaves with the headers, including the redirects. */
  const secured = <T extends NextResponse>(response: T): T => {
    for (const [name, value] of Object.entries(security.headers)) {
      response.headers.set(name, value)
    }
    return response
  }

  const forward = () => {
    const headers = new Headers(request.headers)
    headers.set('x-request-id', requestId)
    headers.set('x-pathname', `${pathname}${search}`)
    // Next reads the nonce out of the request's own CSP header and applies it to the scripts it
    // renders. Setting it only on the response would leave every Next script unnonced and blocked.
    headers.set('x-nonce', security.nonce)
    headers.set('Content-Security-Policy', security.csp)
    const response = NextResponse.next({ request: { headers } })
    response.headers.set('x-request-id', requestId)
    return secured(response)
  }
  const redirectTo = (path: string) => secured(NextResponse.redirect(new URL(path, env().APP_URL)))

  // API routes authenticate themselves in withApi — they also accept bearer tokens.
  if (pathname.startsWith('/api/')) return forward()

  const token = request.cookies.get(ACCESS_COOKIE)?.value
  const verification = token ? await verifyAccessToken(token, env().AUTH_SECRET) : null
  const claims = verification?.ok ? verification.claims : null

  if (!claims) {
    if (isPublicPage(pathname)) return forward()
    const next = encodeURIComponent(`${pathname}${search}`)
    // A refresh token exists (the hint cookie says so): renew silently instead of
    // bouncing someone to the sign-in page every fifteen minutes.
    return request.cookies.has(SESSION_HINT_COOKIE)
      ? redirectTo(`/api/v1/auth/refresh?next=${next}`)
      : redirectTo(`/login?next=${next}`)
  }

  if (pathname === '/' || pathname === '/login')
    return redirectTo(landingPath(claims.prt, claims.pp))

  return forward()
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
  runtime: 'nodejs',
}
