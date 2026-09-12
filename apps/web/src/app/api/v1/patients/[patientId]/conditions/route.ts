import { SetConditionsRequest } from '@clinic/contracts'
import { setChronicConditions } from '@clinic/core/patients'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const PUT = withApi(
  { permission: 'patient:update', body: SetConditionsRequest },
  async ({ actor, body, params }) => ({
    data: await setChronicConditions(actor, params.patientId ?? '', body),
  }),
)
