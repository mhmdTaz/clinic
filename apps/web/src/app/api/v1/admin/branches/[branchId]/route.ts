import { UpdateBranchRequest } from '@clinic/contracts'
import { updateBranch } from '@clinic/core/clinic'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const PUT = withApi(
  { permission: 'portal.admin:access', body: UpdateBranchRequest },
  async ({ actor, body, params }) => ({
    data: await updateBranch(actor, params.branchId ?? '', body),
  }),
)
