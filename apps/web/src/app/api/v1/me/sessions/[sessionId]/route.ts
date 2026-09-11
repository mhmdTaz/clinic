import { revokeMySession } from '@clinic/core/session'
import { withApi } from '@/lib/api/with-api'
import { clearSessionCookies } from '@/lib/auth/cookies'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const DELETE = withApi({}, async ({ actor, params }) => {
  const sessionId = params.sessionId ?? ''
  await revokeMySession(actor, sessionId)
  const current = sessionId === actor.sessionId
  return {
    data: { signedOut: true, current },
    respond: (response) => {
      if (current) clearSessionCookies(response)
    },
  }
})
