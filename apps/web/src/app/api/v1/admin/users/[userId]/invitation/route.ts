import { resendInvitation } from '@clinic/core/users'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Sends a fresh activation link; the earlier ones stop working. */
export const POST = withApi({ permission: 'portal.admin:access' }, async ({ actor, params }) => ({
  data: await resendInvitation(actor, params.userId ?? ''),
}))
