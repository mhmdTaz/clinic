import { MovementListQuery } from '@clinic/contracts'
import { listMovements } from '@clinic/core/inventory'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** The ledger. What it says, in order, is what explains the number on the shelf. */
export const GET = withApi(
  { permission: 'inventory:read', query: MovementListQuery },
  async ({ actor, query }) => ({ data: await listMovements(actor, query) }),
)
