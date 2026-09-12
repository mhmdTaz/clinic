import { SetDiagnosesRequest } from '@clinic/contracts'
import { setDiagnoses } from '@clinic/core/clinical'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * The coded assessment (D7), replaced as a set: which one is primary is a property of the list,
 * not of any single row, so the server normalises it rather than trusting two screens to agree.
 */
export const PUT = withApi(
  { permission: 'encounter:write', body: SetDiagnosesRequest },
  async ({ actor, body, params }) => ({
    data: await setDiagnoses(actor, params.encounterId ?? '', body),
  }),
)
