import { VoidToothRecordRequest } from '@clinic/contracts'
import { voidToothRecord } from '@clinic/core/dental'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** A mistake is voided with a reason, never deleted. 409 RECORD_VOIDED the second time. */
export const POST = withApi(
  { permission: 'dental:write', body: VoidToothRecordRequest },
  async ({ actor, body, params }) => ({
    data: await voidToothRecord(actor, params.recordId ?? '', body),
  }),
)
