import { UpdateInvoiceRequest } from '@clinic/contracts'
import { getInvoice, updateInvoice } from '@clinic/core/billing'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = withApi({ permission: 'invoice:read' }, async ({ actor, params }) => ({
  data: await getInvoice(actor, params.invoiceId ?? ''),
}))

/** Drafts only. Once issued, the copy in the patient's hand is the document (ADR-0027). */
export const PATCH = withApi(
  { permission: 'invoice:create', body: UpdateInvoiceRequest },
  async ({ actor, body, params }) => ({
    data: await updateInvoice(actor, params.invoiceId ?? '', body),
  }),
)
