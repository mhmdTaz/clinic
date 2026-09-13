import { InventoryItemInput, InventoryListQuery } from '@clinic/contracts'
import { createItem, listItems } from '@clinic/core/inventory'
import { paged } from '@/lib/api/paged'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** What is on the shelf (S10). `view=low` and `view=expiring` are the two widgets that matter. */
export const GET = withApi(
  { permission: 'inventory:read', query: InventoryListQuery },
  async ({ actor, query }) => paged(await listItems(actor, query)),
)

export const POST = withApi(
  { permission: 'inventory:manage', body: InventoryItemInput },
  async ({ actor, body }) => ({ status: 201, data: await createItem(actor, body) }),
)
