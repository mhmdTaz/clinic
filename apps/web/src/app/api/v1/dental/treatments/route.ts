import { DentalTreatmentInput } from '@clinic/contracts'
import { createTreatment, listTreatments } from '@clinic/core/dental'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * What can be charted on a tooth (Phase 11). Read by anyone who reads a chart; the first read in
 * a clinic with none writes the starting list. Retired treatments are included, so old rows can
 * still be named.
 */
export const GET = withApi({ permission: 'dental:read' }, async ({ actor }) => ({
  data: await listTreatments(actor),
}))

/** 409 CODE_TAKEN when another treatment already uses the code. */
export const POST = withApi(
  { permission: 'dental:configure', body: DentalTreatmentInput },
  async ({ actor, body }) => ({ status: 201, data: await createTreatment(actor, body) }),
)
