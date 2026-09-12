import { VitalsInput } from '@clinic/contracts'
import { recordVitals } from '@clinic/core/clinical'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** What was measured during the visit. Decimal strings, not floats — a clinician wrote them. */
export const POST = withApi(
  { permission: 'encounter:write', body: VitalsInput },
  async ({ actor, body, params }) => ({
    data: await recordVitals(actor, params.encounterId ?? '', body),
  }),
)
