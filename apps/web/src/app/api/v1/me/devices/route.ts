import { RegisterDeviceRequest } from '@clinic/contracts'
import { listMyDevices, registerDevice } from '@clinic/core/notifications'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Registering this installation for push (§9.4). An upsert on the token, so the app calls it on
 * every launch: tokens are reissued on reinstall and restore, and a stale one is a reminder that
 * never arrives.
 *
 * No permission, like the rest of `/me`: it attaches an address to the caller's own account.
 */
export const POST = withApi({ body: RegisterDeviceRequest }, async ({ actor, body }) => ({
  data: await registerDevice(actor, body),
}))

/**
 * The caller's devices. A device names its own push token in `x-push-token` to be told which row
 * is itself — in a header rather than the query string, so the token never lands in an access log.
 */
export const GET = withApi({}, async ({ actor, request }) => ({
  data: await listMyDevices(actor, request.headers.get('x-push-token') ?? undefined),
}))
