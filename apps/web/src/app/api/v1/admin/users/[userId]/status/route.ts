import { ChangeUserStatusRequest } from '@clinic/contracts'
import { changeUserStatus } from '@clinic/core/users'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** A transition, not a field write (section 9.2): { action: "suspend" | "restore", reason }. */
export const POST = withApi(
  { permission: 'portal.admin:access', body: ChangeUserStatusRequest },
  async ({ actor, body, params }) => ({
    data: await changeUserStatus(actor, params.userId ?? '', body),
  }),
)
