import { completeAppointment } from '@clinic/core/appointments'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** The visit is over. Phase 4 hangs the encounter off this moment. */
export const POST = withApi({ permission: 'appointment:update' }, async ({ actor, params }) => ({
  data: await completeAppointment(actor, params.appointmentId ?? ''),
}))
