import { PaymentListQuery, RecordPaymentRequest } from '@clinic/contracts'
import { listPayments, recordPayment } from '@clinic/core/billing'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = withApi(
  { permission: 'payment:read', query: PaymentListQuery },
  async ({ actor, query }) => ({ data: await listPayments(actor, query) }),
)

/**
 * Taking money. The request carries its own idempotency key, so a double-clicked button gets
 * the same payment back rather than taking the money twice (ADR-0028) — which is why a repeat
 * answers 200 with the existing payment rather than 201 with a new one.
 */
export const POST = withApi(
  { permission: 'payment:record', body: RecordPaymentRequest },
  async ({ actor, body }) => ({ status: 201, data: await recordPayment(actor, body) }),
)
