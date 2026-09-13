import { PrescriptionListQuery } from '@clinic/contracts'
import { listPrescriptions } from '@clinic/core/prescriptions'
import { paged } from '@/lib/api/paged'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** `active=true` is "what am I still meant to be taking" (P7), read in the clinic's timezone. */
export const GET = withApi(
  { permission: 'prescription:read', query: PrescriptionListQuery },
  async ({ actor, query }) => paged(await listPrescriptions(actor, query)),
)
