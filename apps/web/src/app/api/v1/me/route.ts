import { UpdateMeRequest } from '@clinic/contracts'
import { getMe, updateMe } from '@clinic/core/session'
import { withApi } from '@/lib/api/with-api'
import { setAccessCookie } from '@/lib/auth/cookies'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = withApi({}, async ({ actor }) => ({ data: await getMe(actor) }))

export const PATCH = withApi({ body: UpdateMeRequest }, async ({ actor, body, transport }) => {
  const { user, accessToken } = await updateMe(actor, body)
  return {
    data: user,
    // The token carries the name and preferred portal, so a browser gets the new one.
    respond: (response) => {
      if (transport === 'cookie') setAccessCookie(response, accessToken)
    },
  }
})
