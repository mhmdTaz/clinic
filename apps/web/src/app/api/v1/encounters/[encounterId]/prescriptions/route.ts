import { IssuePrescriptionRequest } from '@clinic/contracts'
import { issuePrescription, listPrescriptions } from '@clinic/core/prescriptions'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = withApi({ permission: 'prescription:read' }, async ({ actor, params }) => ({
  data: await listPrescriptions(actor, { encounterId: params.encounterId ?? '' }),
}))

/** Written against the visit it came out of, which is what makes it answerable later (D8). */
export const POST = withApi(
  { permission: 'prescription:issue', body: IssuePrescriptionRequest },
  async ({ actor, body, params }) => ({
    status: 201,
    data: await issuePrescription(actor, params.encounterId ?? '', body),
  }),
)
