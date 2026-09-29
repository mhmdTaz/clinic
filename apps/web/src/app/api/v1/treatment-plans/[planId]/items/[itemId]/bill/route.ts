import { BillPlanItemRequest } from '@clinic/contracts'
import { billPlanItem } from '@clinic/core/dental'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Put a done item on a visit's invoice at the agreed price — the visit's open draft, or a new one.
 * Needs `invoice:create` as well; 409 ALREADY_BILLED the second time, so a retry cannot bill twice.
 */
export const POST = withApi(
  { permission: 'dental:write', body: BillPlanItemRequest },
  async ({ actor, body, params }) => ({
    data: await billPlanItem(actor, params.planId ?? '', params.itemId ?? '', body),
  }),
)
