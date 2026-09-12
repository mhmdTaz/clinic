import { ServiceInput, ServiceListQuery } from '@clinic/contracts'
import { createService, listServices } from '@clinic/core/billing'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** The clinic's price list (A6). Every portal reads it; only an administrator writes it. */
export const GET = withApi(
  { permission: 'service:read', query: ServiceListQuery },
  async ({ actor, query }) => ({ data: await listServices(actor, query) }),
)

export const POST = withApi(
  { permission: 'service:manage', body: ServiceInput },
  async ({ actor, body }) => ({ status: 201, data: await createService(actor, body) }),
)
