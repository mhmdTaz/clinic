import { getPrescription } from '@clinic/core/prescriptions'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = withApi({ permission: 'prescription:read' }, async ({ actor, params }) => ({
  data: await getPrescription(actor, params.prescriptionId ?? ''),
}))
