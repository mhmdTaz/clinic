import { listMySessions, logoutEverywhere } from '@clinic/core/session'
import { withApi } from '@/lib/api/with-api'
import { clearSessionCookies } from '@/lib/auth/cookies'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = withApi({}, async ({ actor }) => ({
  data: { sessions: await listMySessions(actor) },
}))

/** Sign out everywhere, this device included. */
export const DELETE = withApi({}, async ({ actor }) => {
  await logoutEverywhere(actor)
  return { data: { signedOut: true }, respond: (response) => clearSessionCookies(response) }
})
