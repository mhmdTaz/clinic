import { DuplicateCheckRequest } from '@clinic/contracts'
import { checkDuplicates } from '@clinic/core/patients'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** A read, sent as POST so names and ID numbers never appear in a URL or an access log. */
export const POST = withApi(
  { permission: 'patient:read', body: DuplicateCheckRequest },
  async ({ actor, body }) => ({ data: await checkDuplicates(actor, body) }),
)
