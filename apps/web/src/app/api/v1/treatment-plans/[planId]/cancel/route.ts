import { CancelTreatmentPlanRequest } from '@clinic/contracts'
import { cancelTreatmentPlan } from '@clinic/core/dental'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** A plan that no longer matters is cancelled with a reason, never deleted. */
export const POST = withApi(
  { permission: 'dental:write', body: CancelTreatmentPlanRequest },
  async ({ actor, body, params }) => ({
    data: await cancelTreatmentPlan(actor, params.planId ?? '', body),
  }),
)
