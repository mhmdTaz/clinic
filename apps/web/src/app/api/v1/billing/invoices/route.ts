import { CreateInvoiceRequest, InvoiceListQuery } from '@clinic/contracts'
import { createInvoice, listInvoices } from '@clinic/core/billing'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Narrowed by the caller's scope: their own bills, a patient they treat, or the clinic's. */
export const GET = withApi(
  { permission: 'invoice:read', query: InvoiceListQuery },
  async ({ actor, query }) => ({ data: await listInvoices(actor, query) }),
)

export const POST = withApi(
  { permission: 'invoice:create', body: CreateInvoiceRequest },
  async ({ actor, body }) => ({ status: 201, data: await createInvoice(actor, body) }),
)
