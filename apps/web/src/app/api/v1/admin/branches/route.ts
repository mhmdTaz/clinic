import { BranchInput } from '@clinic/contracts'
import { createBranch, getClinicSettings } from '@clinic/core/clinic'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = withApi({ permission: 'portal.admin:access' }, async ({ actor }) => ({
  data: (await getClinicSettings(actor)).branches,
}))

export const POST = withApi(
  { permission: 'portal.admin:access', body: BranchInput },
  async ({ actor, body }) => ({ status: 201, data: await createBranch(actor, body) }),
)
