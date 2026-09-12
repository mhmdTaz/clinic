import { startAppointment } from '@clinic/core/appointments'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** The doctor has taken the patient in. */
export const POST = withApi({ permission: 'appointment:update' }, async ({ actor, params }) => ({
  data: await startAppointment(actor, params.appointmentId ?? ''),
}))
