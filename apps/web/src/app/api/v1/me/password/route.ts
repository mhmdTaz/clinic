import { ChangePasswordRequest } from '@clinic/contracts'
import { changeMyPassword } from '@clinic/core/session'
import { withApi } from '@/lib/api/with-api'
import { setAccessCookie } from '@/lib/auth/cookies'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const PUT = withApi({ body: ChangePasswordRequest }, async ({ actor, body, transport }) => {
  const accessToken = await changeMyPassword(actor, {
    currentPassword: body.currentPassword,
    newPassword: body.newPassword,
  })

  // The token version moved, so the caller's token is now stale. A browser receives the
  // replacement as a cookie; the mobile app receives it in the body.
  return {
    data:
      transport === 'bearer'
        ? {
            changed: true,
            accessToken: accessToken.token,
            accessTokenExpiresAt: accessToken.expiresAt.toISOString(),
          }
        : { changed: true },
    respond: (response) => {
      if (transport === 'cookie') setAccessCookie(response, accessToken)
    },
  }
})
