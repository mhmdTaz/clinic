import { UpdateDoctorRequest } from '@clinic/contracts'
import { getDoctor, updateDoctor } from '@clinic/core/doctors'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = withApi({ permission: 'doctor:read' }, async ({ actor, params }) => ({
  data: await getDoctor(actor, params.doctorId ?? ''),
}))

/** doctor:update at OWN is enough for a doctor's own profile; the use case checks which. */
export const PUT = withApi(
  { permission: 'doctor:update', body: UpdateDoctorRequest },
  async ({ actor, body, params }) => ({
    data: await updateDoctor(actor, params.doctorId ?? '', body),
  }),
)
