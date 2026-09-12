import { z } from 'zod'
import { accountStatement } from '@clinic/core/billing'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const StatementQuery = z.object({ patientId: z.string().max(64).optional() })

/**
 * A statement of account (P8). A patient reaching it without naming anybody gets their own,
 * because the invoice and payment lists narrow to OWN on their behalf.
 */
export const GET = withApi(
  { permission: 'invoice:read', query: StatementQuery },
  async ({ actor, query }) => ({ data: await accountStatement(actor, query.patientId) }),
)
