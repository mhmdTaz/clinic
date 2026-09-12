import { InventoryCategoryInput } from '@clinic/contracts'
import { createCategory, listCategories } from '@clinic/core/inventory'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = withApi({ permission: 'inventory:read' }, async ({ actor }) => ({
  data: await listCategories(actor),
}))

export const POST = withApi(
  { permission: 'inventory:manage', body: InventoryCategoryInput },
  async ({ actor, body }) => ({ status: 201, data: await createCategory(actor, body) }),
)
