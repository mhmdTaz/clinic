import { RefundPaymentRequest } from '@clinic/contracts'
import { refundPayment } from '@clinic/core/billing'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Unwinds the invoices the payment settled, last one first, in a single transaction. */
export const POST = withApi(
  { permission: 'payment:refund', body: RefundPaymentRequest },
  async ({ actor, body, params }) => ({
    data: await refundPayment(actor, params.paymentId ?? '', body),
  }),
)
