import { CreateRoleRequest } from '@clinic/contracts'
import { createRole, listRoleSummaries } from '@clinic/core/access'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = withApi({ permission: 'portal.admin:access' }, async ({ actor }) => ({
  data: await listRoleSummaries(actor),
}))

export const POST = withApi(
  { permission: 'portal.admin:access', body: CreateRoleRequest },
  async ({ actor, body }) => ({ status: 201, data: await createRole(actor, body) }),
)
