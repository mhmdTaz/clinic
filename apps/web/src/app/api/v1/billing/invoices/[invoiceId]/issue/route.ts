import { IssueInvoiceRequest } from '@clinic/contracts'
import { issueInvoice } from '@clinic/core/billing'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = withApi(
  { permission: 'invoice:issue', body: IssueInvoiceRequest },
  async ({ actor, body, params }) => ({
    data: await issueInvoice(actor, params.invoiceId ?? '', body),
  }),
)
