import { AdjustStockRequest } from '@clinic/contracts'
import { adjustStock } from '@clinic/core/inventory'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** A correction, a write-off or a return — each with a reason, because a count needs one. */
export const POST = withApi(
  { permission: 'inventory:adjust', body: AdjustStockRequest },
  async ({ actor, body, params }) => ({
    status: 201,
    data: await adjustStock(actor, params.itemId ?? '', body),
  }),
)
