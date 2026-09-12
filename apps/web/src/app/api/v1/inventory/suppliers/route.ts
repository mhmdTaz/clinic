import { SupplierInput } from '@clinic/contracts'
import { createSupplier, listSuppliers } from '@clinic/core/inventory'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = withApi({ permission: 'inventory:read' }, async ({ actor }) => ({
  data: await listSuppliers(actor),
}))

export const POST = withApi(
  { permission: 'inventory:manage', body: SupplierInput },
  async ({ actor, body }) => ({ status: 201, data: await createSupplier(actor, body) }),
)
