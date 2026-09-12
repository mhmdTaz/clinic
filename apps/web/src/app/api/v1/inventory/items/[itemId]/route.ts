import { InventoryItemInput } from '@clinic/contracts'
import { getItem, updateItem } from '@clinic/core/inventory'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = withApi({ permission: 'inventory:read' }, async ({ actor, params }) => ({
  data: await getItem(actor, params.itemId ?? ''),
}))

/**
 * What the item *is*, never what it holds. A stock level is the ledger's projection, so
 * correcting a count is an adjustment with a stated reason rather than a form field (8.11).
 */
export const PUT = withApi(
  { permission: 'inventory:manage', body: InventoryItemInput },
  async ({ actor, body, params }) => ({
    data: await updateItem(actor, params.itemId ?? '', body),
  }),
)
