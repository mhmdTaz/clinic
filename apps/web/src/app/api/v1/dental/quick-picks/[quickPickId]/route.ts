import { QuickPickInput } from '@clinic/contracts'
import { updateQuickPick } from '@clinic/core/dental'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const PUT = withApi(
  { permission: 'dental:configure', body: QuickPickInput },
  async ({ actor, body, params }) => ({
    data: await updateQuickPick(actor, params.quickPickId ?? '', body),
  }),
)
