import { listMyPatients } from '@clinic/core/clinical'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * "My patients" (D3): everyone this doctor has treated, newest visit first. A query over visits
 * rather than a filter on the clinic's directory, which is what the question actually is
 * (ADR-0004, Phase 4 addendum).
 */
export const GET = withApi({ permission: 'patient:read' }, async ({ actor }) => ({
  data: await listMyPatients(actor),
}))
