import { SetRolePermissionsRequest } from '@clinic/contracts'
import { setRolePermissions } from '@clinic/core/access'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Replaces a role's grants — the permission matrix's save. Refused when it would grant beyond the
 * editor's own access or leave the clinic without an administrator.
 */
export const PUT = withApi(
  { permission: 'portal.admin:access', body: SetRolePermissionsRequest },
  async ({ actor, body, params }) => ({
    data: await setRolePermissions(actor, params.roleId ?? '', body.permissions),
  }),
)
