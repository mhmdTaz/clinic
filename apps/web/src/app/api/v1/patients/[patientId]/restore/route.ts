import { restorePatient } from '@clinic/core/patients'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = withApi({ permission: 'patient:delete' }, async ({ actor, params }) => ({
  data: await restorePatient(actor, params.patientId ?? ''),
}))
