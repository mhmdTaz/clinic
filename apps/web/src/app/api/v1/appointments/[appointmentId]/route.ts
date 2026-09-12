import { getAppointment } from '@clinic/core/appointments'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** The staff note is left out for anyone but the clinic's own people. */
export const GET = withApi({ permission: 'appointment:read' }, async ({ actor, params }) => ({
  data: await getAppointment(actor, params.appointmentId ?? ''),
}))
