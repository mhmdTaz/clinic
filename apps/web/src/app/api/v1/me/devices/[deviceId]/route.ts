import { removeDevice } from '@clinic/core/notifications'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Detaching a device. Scoped to the actor in the repository's filter, not by a preceding read. */
export const DELETE = withApi({}, async ({ actor, params }) => {
  await removeDevice(actor, params.deviceId ?? '')
  return { data: { ok: true } }
})
