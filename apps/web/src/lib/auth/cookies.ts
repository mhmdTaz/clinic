import type { NextResponse } from 'next/server'
import { env } from '@clinic/config'

export const ACCESS_COOKIE = 'clinic_at'
export const REFRESH_COOKIE = 'clinic_rt'

/**
 * A non-secret marker that a refresh token exists. The refresh cookie is scoped to
 * /api/v1/auth, so the middleware cannot see it on page routes; without this hint it
 * could not tell "expired, refresh silently" from "never signed in".
 */
export const SESSION_HINT_COOKIE = 'clinic_session'

/** The refresh token is only ever sent to the auth endpoints, never to a page. */
export const REFRESH_COOKIE_PATH = '/api/v1/auth'

const isSecure = () => env().APP_URL.startsWith('https://')

export function setAccessCookie(response: NextResponse, token: { token: string; expiresAt: Date }) {
  response.cookies.set(ACCESS_COOKIE, token.token, {
    httpOnly: true,
    secure: isSecure(),
    sameSite: 'lax',
    path: '/',
    expires: token.expiresAt,
  })
}

export function setSessionCookies(
  response: NextResponse,
  session: {
    accessToken: string
    accessTokenExpiresAt: Date
    refreshToken: string
    refreshTokenExpiresAt: Date
  },
) {
  setAccessCookie(response, { token: session.accessToken, expiresAt: session.accessTokenExpiresAt })
  // Lax rather than Strict: a Strict cookie is withheld when someone arrives from a link
  // in an email, and a clinic sends a lot of those.
  response.cookies.set(REFRESH_COOKIE, session.refreshToken, {
    httpOnly: true,
    secure: isSecure(),
    sameSite: 'lax',
    path: REFRESH_COOKIE_PATH,
    expires: session.refreshTokenExpiresAt,
  })
  response.cookies.set(SESSION_HINT_COOKIE, '1', {
    httpOnly: true,
    secure: isSecure(),
    sameSite: 'lax',
    path: '/',
    expires: session.refreshTokenExpiresAt,
  })
}

/** Each cookie must be cleared on the same path it was set on, or the browser keeps it. */
export function clearSessionCookies(response: NextResponse) {
  const expired = { httpOnly: true, secure: isSecure(), sameSite: 'lax' as const, maxAge: 0 }
  response.cookies.set(ACCESS_COOKIE, '', { ...expired, path: '/' })
  response.cookies.set(REFRESH_COOKIE, '', { ...expired, path: REFRESH_COOKIE_PATH })
  response.cookies.set(SESSION_HINT_COOKIE, '', { ...expired, path: '/' })
}
