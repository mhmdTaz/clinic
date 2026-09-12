import { AuditListQuery } from '@clinic/contracts'
import { exportAuditCsv } from '@clinic/core/audit-explorer'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * The CSV, returned **inside the envelope** rather than as a `text/csv` body.
 *
 * It keeps one response shape across the whole API (section 9.2) and one code path through
 * `withApi` — the same origin check, the same error mapping, the same audit entry — and the
 * mobile app gets the export for free instead of needing a second transport. The browser turns
 * the string into a file; the payload is bounded by the use case's own 5,000-row cap.
 */
export const GET = withApi(
  { permission: 'audit:export', query: AuditListQuery },
  async ({ actor, query }) => ({ data: await exportAuditCsv(actor, query) }),
)
