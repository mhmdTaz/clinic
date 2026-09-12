import { CancelAppointmentRequest } from '@clinic/contracts'
import { markNoShow } from '@clinic/core/appointments'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** The patient did not arrive. The time is released and the record keeps why. */
export const POST = withApi(
  { permission: 'appointment:update', body: CancelAppointmentRequest },
  async ({ actor, body, params }) => ({
    data: await markNoShow(actor, params.appointmentId ?? '', body.reason),
  }),
)
