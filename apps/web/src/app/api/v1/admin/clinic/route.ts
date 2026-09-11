import { getClinicOverview } from '@clinic/core/clinic'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Everything under /api/v1/admin is gated by the admin portal permission (the coarse
 * check, section 7.6); the use case then checks clinic:read itself. A patient holds
 * clinic:read — they need the clinic's phone number — but has no business here, and
 * gets a 403 plus a permission.denied entry in the audit log.
 */
export const GET = withApi({ permission: 'portal.admin:access' }, async ({ actor }) => ({
  data: await getClinicOverview(actor),
}))
