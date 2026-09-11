import { SetWorkingHoursRequest } from '@clinic/contracts'
import { setBranchWorkingHours } from '@clinic/core/clinic'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const PUT = withApi(
  { permission: 'portal.admin:access', body: SetWorkingHoursRequest },
  async ({ actor, body, params }) => ({
    data: await setBranchWorkingHours(actor, params.branchId ?? '', body),
  }),
)
