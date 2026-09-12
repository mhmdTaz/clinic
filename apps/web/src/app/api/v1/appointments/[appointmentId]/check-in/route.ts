import { checkInAppointment } from '@clinic/core/appointments'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** The patient has arrived at the front desk. */
export const POST = withApi({ permission: 'appointment:check_in' }, async ({ actor, params }) => ({
  data: await checkInAppointment(actor, params.appointmentId ?? ''),
}))
