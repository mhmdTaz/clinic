import { UpdatePatientRequest } from '@clinic/contracts'
import { getPatient, updatePatient } from '@clinic/core/patients'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = withApi({ permission: 'patient:read' }, async ({ actor, params }) => ({
  data: await getPatient(actor, params.patientId ?? ''),
}))

export const PUT = withApi(
  { permission: 'patient:update', body: UpdatePatientRequest },
  async ({ actor, body, params }) => ({
    data: await updatePatient(actor, params.patientId ?? '', body),
  }),
)
