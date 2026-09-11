import { ClinicProfileInput } from '@clinic/contracts'
import { updateClinicProfile } from '@clinic/core/clinic'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Replaces the clinic's editable profile. Answers with the settings as they now stand. */
export const PUT = withApi(
  { permission: 'portal.admin:access', body: ClinicProfileInput },
  async ({ actor, body }) => ({ data: await updateClinicProfile(actor, body) }),
)
