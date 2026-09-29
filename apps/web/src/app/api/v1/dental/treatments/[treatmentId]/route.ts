import { DentalTreatmentInput } from '@clinic/contracts'
import { updateTreatment } from '@clinic/core/dental'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Rename, reprice, reorder or retire a treatment. Rows already charted keep their snapshot; what
 * the treatment draws — its symbol and scope — cannot change once it exists.
 */
export const PUT = withApi(
  { permission: 'dental:configure', body: DentalTreatmentInput },
  async ({ actor, body, params }) => ({
    data: await updateTreatment(actor, params.treatmentId ?? '', body),
  }),
)
