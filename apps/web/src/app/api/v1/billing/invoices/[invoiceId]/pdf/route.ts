import { getInvoicePdf } from '@clinic/core/billing'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Rendered once, stored, then served by a short-lived link from object storage (ADR-0026). */
export const GET = withApi({ permission: 'invoice:read' }, async ({ actor, params }) => ({
  data: await getInvoicePdf(actor, params.invoiceId ?? ''),
}))
