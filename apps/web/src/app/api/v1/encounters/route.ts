import { EncounterListQuery, OpenEncounterRequest } from '@clinic/contracts'
import { listEncounters, openEncounter } from '@clinic/core/clinical'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Visits, filtered to what the caller's encounter:read scope reaches: the clinic for staff, the
 * ones they conducted for a doctor, their own for a patient (ADR-0004).
 */
export const GET = withApi(
  { permission: 'encounter:read', query: EncounterListQuery },
  async ({ actor, query }) => ({ data: await listEncounters(actor, query) }),
)

/** Opening a visit (D6). One per appointment, so the record of it cannot end up in two halves. */
export const POST = withApi(
  { permission: 'encounter:write', body: OpenEncounterRequest },
  async ({ actor, body }) => ({ status: 201, data: await openEncounter(actor, body) }),
)
