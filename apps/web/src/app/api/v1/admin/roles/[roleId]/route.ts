import { UpdateRoleRequest } from '@clinic/contracts'
import { deleteRole, getRole, updateRole } from '@clinic/core/access'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = withApi({ permission: 'portal.admin:access' }, async ({ actor, params }) => ({
  data: await getRole(actor, params.roleId ?? ''),
}))

export const PUT = withApi(
  { permission: 'portal.admin:access', body: UpdateRoleRequest },
  async ({ actor, body, params }) => ({
    data: await updateRole(actor, params.roleId ?? '', body),
  }),
)

export const DELETE = withApi({ permission: 'portal.admin:access' }, async ({ actor, params }) => {
  await deleteRole(actor, params.roleId ?? '')
  return { data: { deleted: true } }
})
