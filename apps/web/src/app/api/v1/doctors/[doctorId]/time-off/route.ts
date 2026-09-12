import { TimeOffInput } from '@clinic/contracts'
import { addDoctorTimeOff } from '@clinic/core/doctors'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Days away, as calendar dates in the clinic's zone, both ends inclusive (ADR-0010). */
export const POST = withApi(
  { permission: 'availability:manage', body: TimeOffInput },
  async ({ actor, body, params }) => ({
    status: 201,
    data: await addDoctorTimeOff(actor, params.doctorId ?? '', body),
  }),
)
