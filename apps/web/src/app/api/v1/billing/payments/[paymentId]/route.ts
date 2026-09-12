import { getPayment } from '@clinic/core/billing'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = withApi({ permission: 'payment:read' }, async ({ actor, params }) => ({
  data: await getPayment(actor, params.paymentId ?? ''),
}))
