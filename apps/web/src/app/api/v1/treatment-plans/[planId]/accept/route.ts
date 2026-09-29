import { AcceptTreatmentPlanRequest } from '@clinic/contracts'
import { acceptTreatmentPlan } from '@clinic/core/dental'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * The patient agrees, with their name and, usually, a drawn signature uploaded first. 409
 * PLAN_OUT_OF_DATE when the chart moved on since the plan was drawn up; 409 ALREADY_AGREED when
 * some of the work is in another agreed plan.
 */
export const POST = withApi(
  { permission: 'dental:write', body: AcceptTreatmentPlanRequest },
  async ({ actor, body, params }) => ({
    data: await acceptTreatmentPlan(actor, params.planId ?? '', body),
  }),
)
