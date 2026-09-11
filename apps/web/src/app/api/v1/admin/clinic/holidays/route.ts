import { SetHolidaysRequest } from '@clinic/contracts'
import { setClinicHolidays } from '@clinic/core/clinic'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Replaces the whole list of closures: one write, so a half-saved list cannot exist. */
export const PUT = withApi(
  { permission: 'portal.admin:access', body: SetHolidaysRequest },
  async ({ actor, body }) => ({ data: await setClinicHolidays(actor, body) }),
)
