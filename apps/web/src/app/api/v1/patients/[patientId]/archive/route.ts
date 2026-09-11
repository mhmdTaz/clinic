import { archivePatient } from '@clinic/core/patients'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Hides the record from the directory. Nothing in it is deleted (section 8.3). */
export const POST = withApi({ permission: 'patient:delete' }, async ({ actor, params }) => ({
  data: await archivePatient(actor, params.patientId ?? ''),
}))
