import { AppointmentListQuery, BookAppointmentRequest } from '@clinic/contracts'
import { bookAppointment, listAppointments } from '@clinic/core/appointments'
import { paged } from '@/lib/api/paged'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * The calendar, filtered to what the caller's appointment:read scope reaches: the clinic for
 * staff, their own column for a doctor, their own appointments for a patient (ADR-0004).
 */
export const GET = withApi(
  { permission: 'appointment:read', query: AppointmentListQuery },
  async ({ actor, query }) => paged(await listAppointments(actor, query)),
)

/** 409 SLOT_TAKEN when another booking claimed the time first (ADR-0013). */
export const POST = withApi(
  { permission: 'appointment:create', body: BookAppointmentRequest, idempotent: true },
  async ({ actor, body }) => ({ status: 201, data: await bookAppointment(actor, body) }),
)
