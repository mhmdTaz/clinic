import { ChangeLabOrderStatusRequest } from '@clinic/contracts'
import { changeLabOrderStatus } from '@clinic/core/dental'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Received, fitted, sent back for a remake (with the new date), or cancelled (with a reason).
 * 409 LAB_ORDER_STATE for a move the order cannot make, or one somebody made a moment ago.
 */
export const POST = withApi(
  { permission: 'dental:write', body: ChangeLabOrderStatusRequest },
  async ({ actor, body, params }) => ({
    data: await changeLabOrderStatus(actor, params.orderId ?? '', body),
  }),
)
