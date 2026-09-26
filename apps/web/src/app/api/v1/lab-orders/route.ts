import { LabOrderListQuery } from '@clinic/contracts'
import { listLabOrders } from '@clinic/core/dental'
import { paged } from '@/lib/api/paged'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** The clinic's lab board, soonest due first. Clinic-wide, so the chart at clinic scope. */
export const GET = withApi(
  { permission: 'dental:read', query: LabOrderListQuery },
  async ({ actor, query }) => paged(await listLabOrders(actor, query)),
)
