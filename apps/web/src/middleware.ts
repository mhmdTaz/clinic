import { NextResponse, type NextRequest } from 'next/server'
import { env } from '@clinic/config'
import { landingPath, verifyAccessToken } from '@clinic/core/edge'
import { ACCESS_COOKIE, SESSION_HINT_COOKIE } from '@/lib/auth/cookies'

/**
 * Deliberately thin (section 10.2): is there a valid session, and if not, can one be
 * refreshed? It never touches the database.
 *
 * Portal permissions are NOT checked here. Each portal's layout checks them with
 * assertCan, which is authoritative against current grants and records the denial in
 * the audit log — a redirect from middleware could do neither.
 */
const PUBLIC_PAGES = ['/login', '/forgot-password', '/reset-password', '/accept-invite']

function isPublicPage(pathname: string): boolean {
  return PUBLIC_PAGES.some((page) => pathname === page || pathname.startsWith(`${page}/`))
}

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl
  const requestId = request.headers.get('x-request-id') ?? crypto.randomUUID()

  const forward = () => {
    const headers = new Headers(request.headers)
    headers.set('x-request-id', requestId)
    headers.set('x-pathname', `${pathname}${search}`)
    const response = NextResponse.next({ request: { headers } })
    response.headers.set('x-request-id', requestId)
    return response
  }
  const redirectTo = (path: string) => NextResponse.redirect(new URL(path, env().APP_URL))

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
