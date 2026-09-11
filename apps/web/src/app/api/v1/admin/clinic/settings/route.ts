import { getClinicSettings } from '@clinic/core/clinic'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** The editable settings: profile, locations with their hours, and closures (A1, A2). */
export const GET = withApi({ permission: 'portal.admin:access' }, async ({ actor }) => ({
  data: await getClinicSettings(actor),
}))
