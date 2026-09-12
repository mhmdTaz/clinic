import { VoidInvoiceRequest } from '@clinic/contracts'
import { voidInvoice } from '@clinic/core/billing'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** A reason is required: a void with none is a disappearance, not a correction. */
export const POST = withApi(
  { permission: 'invoice:void', body: VoidInvoiceRequest },
  async ({ actor, body, params }) => ({
    data: await voidInvoice(actor, params.invoiceId ?? '', body),
  }),
)
