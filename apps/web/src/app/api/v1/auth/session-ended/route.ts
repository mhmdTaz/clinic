import { NextResponse, type NextRequest } from 'next/server'
import { env } from '@clinic/config'
import { clearSessionCookies } from '@/lib/auth/cookies'
import { safeNextPath } from '@/lib/auth/safe-next'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Reached when a page finds the session was signed out elsewhere while its token's
 * signature is still valid. Only a route handler can clear cookies; without this step the
 * middleware would keep trusting the token and the browser would loop between the page
 * and the sign-in screen.
 *
 * It clears this browser's own cookies and nothing else, so a cross-site link here can at
 * worst sign someone out.
 */
export async function GET(request: NextRequest) {
  const next = safeNextPath(request.nextUrl.searchParams.get('next'))
  const response = NextResponse.redirect(
    new URL(`/login?next=${encodeURIComponent(next)}&reason=ended`, env().APP_URL),
    303,
  )
  clearSessionCookies(response)
  return response
}
