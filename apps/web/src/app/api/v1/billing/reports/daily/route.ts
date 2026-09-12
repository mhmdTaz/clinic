import { DailyReconciliationQuery } from '@clinic/contracts'
import { dailyReconciliation } from '@clinic/core/billing'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * The day the front desk closes on (S9). Gated on a clinic-wide `payment:read`: a patient's own
 * payments are not the clinic's day, and the use case refuses a narrower scope outright.
 */
export const GET = withApi(
  { permission: 'payment:read', query: DailyReconciliationQuery },
  async ({ actor, query }) => ({ data: await dailyReconciliation(actor, query) }),
)
