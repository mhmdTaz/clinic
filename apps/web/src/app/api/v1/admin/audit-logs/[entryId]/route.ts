import { getAuditEntry } from '@clinic/core/audit-explorer'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = withApi({ permission: 'audit:read' }, async ({ actor, params }) => ({
  data: await getAuditEntry(actor, params.entryId ?? ''),
}))
