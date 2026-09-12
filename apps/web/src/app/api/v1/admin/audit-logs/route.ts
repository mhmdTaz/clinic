import { AuditListQuery } from '@clinic/contracts'
import { listAuditEntries } from '@clinic/core/audit-explorer'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * One page of the audit log. Reading it writes an `audit.viewed` entry of its own (11.6), which
 * is why this route has no cache and never will.
 */
export const GET = withApi(
  { permission: 'audit:read', query: AuditListQuery },
  async ({ actor, query }) => {
    const page = await listAuditEntries(actor, query)
    return {
      data: page.items,
      meta: { nextCursor: page.nextCursor, hasMore: page.nextCursor !== null },
    }
  },
)
