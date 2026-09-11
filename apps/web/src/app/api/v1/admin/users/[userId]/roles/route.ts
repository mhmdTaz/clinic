import { SetUserRolesRequest } from '@clinic/contracts'
import { setUserRoles } from '@clinic/core/users'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Replaces the user's roles. Every session they hold picks the change up on its next request. */
export const PUT = withApi(
  { permission: 'portal.admin:access', body: SetUserRolesRequest },
  async ({ actor, body, params }) => ({
    data: await setUserRoles(actor, params.userId ?? '', body),
  }),
)
