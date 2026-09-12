import { verifyAuditChain } from '@clinic/core/audit-explorer'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** On-demand tamper check (11.5). The same verdict the nightly job computes. */
export const GET = withApi({ permission: 'audit:read' }, async ({ actor }) => ({
  data: await verifyAuditChain(actor),
}))
