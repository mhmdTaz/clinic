import { TreatmentPlanInput, TreatmentPlanListQuery } from '@clinic/contracts'
import { createTreatmentPlan, listTreatmentPlans } from '@clinic/core/dental'
import { paged } from '@/lib/api/paged'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** A patient's treatment plans, newest first. */
export const GET = withApi(
  { permission: 'dental:read', query: TreatmentPlanListQuery },
  async ({ actor, query, params }) =>
    paged(await listTreatmentPlans(actor, params.patientId ?? '', query)),
)

/** Draft a plan from planned work on the chart, priced from the price list. */
export const POST = withApi(
  { permission: 'dental:write', body: TreatmentPlanInput, idempotent: true },
  async ({ actor, body, params }) => ({
    status: 201,
    data: await createTreatmentPlan(actor, params.patientId ?? '', body),
  }),
)
