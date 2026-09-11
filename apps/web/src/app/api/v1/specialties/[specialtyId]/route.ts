import { UpdateSpecialtyRequest } from '@clinic/contracts'
import { updateSpecialty } from '@clinic/core/doctors'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Rename or retire. A rename refreshes the name on every doctor who has the specialty. */
export const PUT = withApi(
  { permission: 'specialty:manage', body: UpdateSpecialtyRequest },
  async ({ actor, body, params }) => ({
    data: await updateSpecialty(actor, params.specialtyId ?? '', body),
  }),
)
