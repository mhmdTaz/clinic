import { CancelAppointmentRequest } from '@clinic/contracts'
import { cancelAppointment } from '@clinic/core/appointments'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Frees the time. A patient cancelling their own is held to the clinic's cutoff (ADR-0022). */
export const POST = withApi(
  { permission: 'appointment:cancel', body: CancelAppointmentRequest, idempotent: true },
  async ({ actor, body, params }) => ({
    data: await cancelAppointment(actor, params.appointmentId ?? '', body),
  }),
)
