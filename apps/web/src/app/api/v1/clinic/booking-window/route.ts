import { getBookingWindow } from '@clinic/core/clinic'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * The rules a patient books by: horizon, notice, cancellation cutoff (ADR-0022). Readable by anyone
 * holding `clinic:read` — which includes the patients bound by it.
 */
export const GET = withApi({ permission: 'clinic:read' }, async ({ actor }) => ({
  data: await getBookingWindow(actor),
}))
