import { BookOwnAppointmentRequest } from '@clinic/contracts'
import { bookOwnAppointment } from '@clinic/core/appointments'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Self-service booking (P5). The server supplies who the patient is, so a request cannot book
 * on someone else's behalf, and the clinic's window applies (ADR-0022).
 */
export const POST = withApi(
  { permission: 'appointment:create', body: BookOwnAppointmentRequest, idempotent: true },
  async ({ actor, body }) => ({ status: 201, data: await bookOwnAppointment(actor, body) }),
)
