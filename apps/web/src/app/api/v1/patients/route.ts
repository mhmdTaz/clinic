import { PatientListQuery, RegisterPatientRequest } from '@clinic/contracts'
import { listPatients, registerPatient } from '@clinic/core/patients'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * The directory, filtered to what the caller's patient:read scope reaches: the whole clinic for
 * staff, their own record for a patient (section 7.5).
 */
export const GET = withApi(
  { permission: 'patient:read', query: PatientListQuery },
  async ({ actor, query }) => {
    const page = await listPatients(actor, query)
    return {
      data: page.items,
      meta: { nextCursor: page.nextCursor, hasMore: page.nextCursor !== null },
    }
  },
)

/** 409 POSSIBLE_DUPLICATE until the caller confirms with a duplicateOverride (ADR-0020). */
export const POST = withApi(
  { permission: 'patient:create', body: RegisterPatientRequest },
  async ({ actor, body }) => ({ status: 201, data: await registerPatient(actor, body) }),
)
