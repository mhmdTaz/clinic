import { presentTreatmentPlan } from '@clinic/core/dental'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** The plan has been shown to the patient. Showing it again only moves the date. */
export const POST = withApi({ permission: 'dental:write' }, async ({ actor, params }) => ({
  data: await presentTreatmentPlan(actor, params.planId ?? ''),
}))
