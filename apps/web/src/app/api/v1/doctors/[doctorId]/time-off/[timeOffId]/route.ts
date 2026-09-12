import { removeDoctorTimeOff } from '@clinic/core/doctors'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** The doctor is back. Appointments booked around the absence are left where they are. */
export const DELETE = withApi({ permission: 'availability:manage' }, async ({ actor, params }) => ({
  data: await removeDoctorTimeOff(actor, params.doctorId ?? '', params.timeOffId ?? ''),
}))
