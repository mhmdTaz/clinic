import { AnalyticsQuery } from '@clinic/contracts'
import { getAnalyticsOverview } from '@clinic/core/analytics'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = withApi(
  { permission: 'analytics:read', query: AnalyticsQuery },
  async ({ actor, query }) => ({ data: await getAnalyticsOverview(actor, query) }),
)
