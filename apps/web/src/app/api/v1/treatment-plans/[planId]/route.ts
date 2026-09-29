import { TreatmentPlanInput } from '@clinic/contracts'
import { getTreatmentPlan, updateTreatmentPlan } from '@clinic/core/dental'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = withApi({ permission: 'dental:read' }, async ({ actor, params }) => ({
  data: await getTreatmentPlan(actor, params.planId ?? ''),
}))

/** Rewrite a draft or presented plan. A presented one goes back to DRAFT, to be shown again. */
export const PUT = withApi(
  { permission: 'dental:write', body: TreatmentPlanInput },
  async ({ actor, body, params }) => ({
    data: await updateTreatmentPlan(actor, params.planId ?? '', body),
  }),
)
