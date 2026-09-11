import { APP_VERSION } from '@clinic/config'
import { checkHealth } from '@clinic/core/health'
import { withApi } from '@/lib/api/with-api'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Readiness for the load balancer. Returns 503 when a dependency is down so an
 * unhealthy instance is actually removed from rotation rather than quietly serving
 * errors.
 */
export const GET = withApi(async () => {
  const payload = await checkHealth(APP_VERSION)
  return { status: payload.status === 'ok' ? 200 : 503, data: payload }
})
