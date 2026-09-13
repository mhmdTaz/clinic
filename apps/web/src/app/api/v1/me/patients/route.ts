import { PaginationQuery } from '@clinic/contracts'
import { listMyPatients } from '@clinic/core/clinical'
import { paged } from '@/lib/api/paged'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * "My patients" (D3): everyone this doctor has treated, newest visit first. A query over visits
 * rather than a filter on the clinic's directory, which is what the question actually is
 * (ADR-0004, Phase 4 addendum).
 */
export const GET = withApi(
  { permission: 'patient:read', query: PaginationQuery },
  async ({ actor, query }) => paged(await listMyPatients(actor, query)),
)
