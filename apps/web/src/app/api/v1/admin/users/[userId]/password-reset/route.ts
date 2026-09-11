import { forceUserPasswordReset } from '@clinic/core/users'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** The old password stops working, every session ends, and a reset link is emailed. */
export const POST = withApi({ permission: 'portal.admin:access' }, async ({ actor, params }) => ({
  data: await forceUserPasswordReset(actor, params.userId ?? ''),
}))
