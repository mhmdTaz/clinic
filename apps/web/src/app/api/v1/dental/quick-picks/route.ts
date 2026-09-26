import { QuickPickInput } from '@clinic/contracts'
import { createQuickPick, listQuickPicks } from '@clinic/core/dental'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** The one-tap presets: the clinic's, and the calling dentist's own. */
export const GET = withApi({ permission: 'dental:read' }, async ({ actor }) => ({
  data: await listQuickPicks(actor),
}))

export const POST = withApi(
  { permission: 'dental:configure', body: QuickPickInput },
  async ({ actor, body }) => ({ status: 201, data: await createQuickPick(actor, body) }),
)
