import { ApplyQuickPickRequest } from '@clinic/contracts'
import { applyQuickPick } from '@clinic/core/dental'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** One tap, several rows, written together or not at all. */
export const POST = withApi(
  { permission: 'dental:write', body: ApplyQuickPickRequest, idempotent: true },
  async ({ actor, body, params }) => ({
    status: 201,
    data: await applyQuickPick(actor, params.patientId ?? '', params.quickPickId ?? '', body),
  }),
)
