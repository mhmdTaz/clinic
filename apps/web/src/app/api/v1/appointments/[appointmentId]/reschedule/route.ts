import { RescheduleAppointmentRequest } from '@clinic/contracts'
import { rescheduleAppointment } from '@clinic/core/appointments'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Keeps the number and the history; the reservations move with the appointment. */
export const POST = withApi(
  { permission: 'appointment:update', body: RescheduleAppointmentRequest, idempotent: true },
  async ({ actor, body, params }) => ({
    data: await rescheduleAppointment(actor, params.appointmentId ?? '', body),
  }),
)
