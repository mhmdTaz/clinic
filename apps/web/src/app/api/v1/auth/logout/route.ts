import { LogoutRequest } from '@clinic/contracts'
import { logout } from '@clinic/core/session'
import { withApi } from '@/lib/api/with-api'
import { REFRESH_COOKIE, clearSessionCookies } from '@/lib/auth/cookies'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Works with an expired access token too: the refresh token alone identifies the session. */
export const POST = withApi(
  { auth: 'optional', body: LogoutRequest },
  async ({ actor, body, request }) => {
    await logout({
      actor,
      refreshToken: body.refreshToken ?? request.cookies.get(REFRESH_COOKIE)?.value ?? null,
      pushToken: body.pushToken ?? null,
    })
    return { data: { signedOut: true }, respond: (response) => clearSessionCookies(response) }
  },
)
