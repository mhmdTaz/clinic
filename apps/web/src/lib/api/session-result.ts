import type { SessionResult } from '@clinic/contracts'
import type { IssuedSession } from '@clinic/core/session'
import { setSessionCookies } from '@/lib/auth/cookies'
import type { ApiResult } from './with-api'

/**
 * Browsers receive httpOnly cookies and never see a token in JavaScript. The mobile app
 * asks for "body" delivery and stores the tokens in the device's secure storage.
 */
export function sessionResult(
  session: IssuedSession,
  delivery: 'cookie' | 'body',
): ApiResult<SessionResult> {
  if (delivery === 'body') {
    return {
      data: {
        user: session.user,
        tokens: {
          accessToken: session.accessToken,
          accessTokenExpiresAt: session.accessTokenExpiresAt.toISOString(),
          refreshToken: session.refreshToken,
          refreshTokenExpiresAt: session.refreshTokenExpiresAt.toISOString(),
        },
      },
    }
  }
  return {
    data: { user: session.user },
    respond: (response) => setSessionCookies(response, session),
  }
}
