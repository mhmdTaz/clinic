import { ReceiveStockRequest } from '@clinic/contracts'
import { receiveStock } from '@clinic/core/inventory'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** A delivery: one batch in, one ledger row, and the balance it produced recorded on the row. */
export const POST = withApi(
  { permission: 'inventory:manage', body: ReceiveStockRequest },
  async ({ actor, body, params }) => ({
    status: 201,
    data: await receiveStock(actor, params.itemId ?? '', body),
  }),
)
