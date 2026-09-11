import { APP_VERSION } from '@clinic/config'
import { checkHealth } from '@clinic/core/health'
import { withApi } from '@/lib/api/with-api'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Readiness for the load balancer. Returns 503 only when a CRITICAL dependency is down,
 * so an instance that cannot serve leaves rotation — but a Redis outage, which degrades
 * rate limiting and nothing else, does not take every instance out at once.
 */
export const GET = withApi({ auth: 'none' }, async () => {
  const payload = await checkHealth(APP_VERSION)
  return { status: payload.ready ? 200 : 503, data: payload }
})
