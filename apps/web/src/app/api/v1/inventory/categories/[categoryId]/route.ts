import { InventoryCategoryInput } from '@clinic/contracts'
import { updateCategory } from '@clinic/core/inventory'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const PUT = withApi(
  { permission: 'inventory:manage', body: InventoryCategoryInput },
  async ({ actor, body, params }) => ({
    data: await updateCategory(actor, params.categoryId ?? '', body),
  }),
)
