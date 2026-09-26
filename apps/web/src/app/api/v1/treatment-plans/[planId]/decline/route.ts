import { DeclineTreatmentPlanRequest } from '@clinic/contracts'
import { declineTreatmentPlan } from '@clinic/core/dental'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** The patient says no. The plan stays on the record, with the reason if they gave one. */
export const POST = withApi(
  { permission: 'dental:write', body: DeclineTreatmentPlanRequest },
  async ({ actor, body, params }) => ({
    data: await declineTreatmentPlan(actor, params.planId ?? '', body),
  }),
)
