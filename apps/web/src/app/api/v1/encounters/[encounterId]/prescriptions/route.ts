import { IssuePrescriptionRequest, PaginationQuery } from '@clinic/contracts'
import { issuePrescription, listPrescriptions } from '@clinic/core/prescriptions'
import { paged } from '@/lib/api/paged'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** One visit's prescriptions: a page like any other list, though a visit rarely fills one. */
export const GET = withApi(
  { permission: 'prescription:read', query: PaginationQuery },
  async ({ actor, params, query }) =>
    paged(await listPrescriptions(actor, { ...query, encounterId: params.encounterId ?? '' })),
)

/** Written against the visit it came out of, which is what makes it answerable later (D8). */
export const POST = withApi(
  { permission: 'prescription:issue', body: IssuePrescriptionRequest },
  async ({ actor, body, params }) => ({
    status: 201,
    data: await issuePrescription(actor, params.encounterId ?? '', body),
  }),
)
