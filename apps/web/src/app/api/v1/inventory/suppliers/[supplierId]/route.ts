import { SupplierInput } from '@clinic/contracts'
import { updateSupplier } from '@clinic/core/inventory'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const PUT = withApi(
  { permission: 'inventory:manage', body: SupplierInput },
  async ({ actor, body, params }) => ({
    data: await updateSupplier(actor, params.supplierId ?? '', body),
  }),
)
