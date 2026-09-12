import { SetNotificationPreferencesRequest } from '@clinic/contracts'
import { getNotificationPreferences, setNotificationPreferences } from '@clinic/core/notifications'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** What this person wants to hear about. Their own, always — see the note on the feed route. */
export const GET = withApi({}, async ({ actor }) => ({
  data: await getNotificationPreferences(actor),
}))

export const PUT = withApi(
  { body: SetNotificationPreferencesRequest },
  async ({ actor, body }) => ({ data: await setNotificationPreferences(actor, body) }),
)
