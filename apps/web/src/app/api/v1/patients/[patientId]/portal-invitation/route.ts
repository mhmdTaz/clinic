import { invitePatientToPortal } from '@clinic/core/patients'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Creates and links the portal account, or sends a new link to one still waiting (ADR-0006). */
export const POST = withApi({ permission: 'patient:update' }, async ({ actor, params }) => ({
  data: await invitePatientToPortal(actor, params.patientId ?? ''),
}))
