import { CreateLabOrderRequest, PatientLabOrderQuery } from '@clinic/contracts'
import { createLabOrder, listPatientLabOrders } from '@clinic/core/dental'
import { paged } from '@/lib/api/paged'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** A patient's lab work, newest first; `open=true` for what is not fitted or called off. */
export const GET = withApi(
  { permission: 'dental:read', query: PatientLabOrderQuery },
  async ({ actor, query, params }) =>
    paged(await listPatientLabOrders(actor, params.patientId ?? '', query)),
)

/** Send work to the lab for rows on the chart. A retried request must not send it twice. */
export const POST = withApi(
  { permission: 'dental:write', body: CreateLabOrderRequest, idempotent: true },
  async ({ actor, body, params }) => ({
    status: 201,
    data: await createLabOrder(actor, params.patientId ?? '', body),
  }),
)
