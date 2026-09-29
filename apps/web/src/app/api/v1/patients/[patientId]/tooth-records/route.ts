import { AddToothRecordRequest, ToothRecordListQuery } from '@clinic/contracts'
import { addToothRecord, listToothRecords } from '@clinic/core/dental'
import { paged } from '@/lib/api/paged'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** The log behind the chart, newest first: one tooth's timeline, one visit's work, one status. */
export const GET = withApi(
  { permission: 'dental:read', query: ToothRecordListQuery },
  async ({ actor, query, params }) =>
    paged(await listToothRecords(actor, params.patientId ?? '', query)),
)

/**
 * Chart one thing on one or more teeth. The row is never edited afterwards — a mistake is voided
 * — so a retried request must not write it twice.
 */
export const POST = withApi(
  { permission: 'dental:write', body: AddToothRecordRequest, idempotent: true },
  async ({ actor, body, params }) => ({
    status: 201,
    data: await addToothRecord(actor, params.patientId ?? '', body),
  }),
)
