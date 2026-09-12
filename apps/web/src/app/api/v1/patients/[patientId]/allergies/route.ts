import { SetAllergiesRequest } from '@clinic/contracts'
import { setAllergies } from '@clinic/core/patients'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** The chart banner (D4). Replaced whole: an allergy list is edited as a list. */
export const PUT = withApi(
  { permission: 'patient:update', body: SetAllergiesRequest },
  async ({ actor, body, params }) => ({
    data: await setAllergies(actor, params.patientId ?? '', body),
  }),
)
