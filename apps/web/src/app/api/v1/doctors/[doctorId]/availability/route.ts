import { SetAvailabilityRequest } from '@clinic/contracts'
import { getDoctorSchedule, setDoctorAvailability } from '@clinic/core/doctors'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** A doctor's week and days away (S4, D10). A doctor holding OWN reads only their own. */
export const GET = withApi({ permission: 'availability:read' }, async ({ actor, params }) => ({
  data: await getDoctorSchedule(actor, params.doctorId ?? ''),
}))

/** The week is replaced whole: a schedule is edited as one thing, not block by block. */
export const PUT = withApi(
  { permission: 'availability:manage', body: SetAvailabilityRequest },
  async ({ actor, body, params }) => ({
    data: await setDoctorAvailability(actor, params.doctorId ?? '', body),
  }),
)
