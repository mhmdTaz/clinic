import { ServiceInput } from '@clinic/contracts'
import { updateService } from '@clinic/core/billing'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Editing the catalogue changes the next invoice, never one already written (section 8.2). */
export const PUT = withApi(
  { permission: 'service:manage', body: ServiceInput },
  async ({ actor, body, params }) => ({
    data: await updateService(actor, params.serviceId ?? '', body),
  }),
)
