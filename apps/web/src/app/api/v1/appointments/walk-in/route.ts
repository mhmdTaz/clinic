import { RegisterWalkInRequest } from '@clinic/contracts'
import { registerWalkIn } from '@clinic/core/appointments'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Someone arrived without an appointment (S5, ADR-0023). The server chooses the time — the
 * doctor's next open slot today — so a walk-in never books off the grid, and checks them in,
 * because they are already at the desk. 422 NO_SLOT_TODAY when the doctor's day is full.
 */
export const POST = withApi(
  { permission: 'appointment:create', body: RegisterWalkInRequest, idempotent: true },
  async ({ actor, body }) => ({ status: 201, data: await registerWalkIn(actor, body) }),
)
