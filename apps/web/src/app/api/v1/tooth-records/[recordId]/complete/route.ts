import { CompleteToothRecordRequest } from '@clinic/contracts'
import { completeToothRecord } from '@clinic/core/dental'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Planned work, done. Adds a COMPLETED row pointing at the plan; the plan itself is unchanged.
 * 409 ALREADY_COMPLETED, NOT_PLANNED or RECORD_VOIDED when there is nothing left to carry out.
 */
export const POST = withApi(
  { permission: 'dental:write', body: CompleteToothRecordRequest, idempotent: true },
  async ({ actor, body, params }) => ({
    status: 201,
    data: await completeToothRecord(actor, params.recordId ?? '', body),
  }),
)
