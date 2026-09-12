import { stockAlerts } from '@clinic/core/inventory'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** What is running out and what is going off, both derived from the shelf as it is now. */
export const GET = withApi({ permission: 'inventory:read' }, async ({ actor }) => ({
  data: await stockAlerts(actor),
}))
