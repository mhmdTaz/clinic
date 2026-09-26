import { OverduePlansQuery } from '@clinic/contracts'
import { listOverduePlans } from '@clinic/core/dental'
import { paged } from '@/lib/api/paged'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Recall: agreed plans with work left, longest-waiting first, unbooked patients by default. */
export const GET = withApi(
  { permission: 'dental:read', query: OverduePlansQuery },
  async ({ actor, query }) => paged(await listOverduePlans(actor, query)),
)
