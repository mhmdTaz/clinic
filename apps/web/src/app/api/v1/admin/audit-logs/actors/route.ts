import { auditActorOptions } from '@clinic/core/audit-explorer'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Who appears in the log, for the explorer's actor filter. */
export const GET = withApi({ permission: 'audit:read' }, async ({ actor }) => ({
  data: await auditActorOptions(actor),
}))
