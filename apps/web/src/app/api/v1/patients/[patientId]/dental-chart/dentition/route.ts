import { SetDentitionRequest } from '@clinic/contracts'
import { setDentition } from '@clinic/core/dental'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Permanent, primary or mixed. Answers with the chart as the new dentition draws it. */
export const PUT = withApi(
  { permission: 'dental:write', body: SetDentitionRequest },
  async ({ actor, body, params }) => ({
    data: await setDentition(actor, params.patientId ?? '', body),
  }),
)
