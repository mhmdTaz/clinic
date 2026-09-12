import { MarkNotificationsReadRequest, NotificationListQuery } from '@clinic/contracts'
import { markNotificationsRead, notificationFeed } from '@clinic/core/notifications'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * The signed-in person's own bell.
 *
 * No permission, deliberately: a notification is addressed to one user by id, and the only id
 * these read is the caller's own. There is no parameter through which somebody could ask for
 * another person's, so there is nothing for a permission to gate.
 */
export const GET = withApi({ query: NotificationListQuery }, async ({ actor, query }) => ({
  data: await notificationFeed(actor, query),
}))

export const POST = withApi({ body: MarkNotificationsReadRequest }, async ({ actor, body }) => ({
  data: await markNotificationsRead(actor, body),
}))
