import { SlotQuery } from '@clinic/contracts'
import { offerSlots } from '@clinic/core/appointments'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * What the doctor can be booked into, computed on every call (section 8.7). A patient asking
 * receives only what the clinic's notice period still allows (ADR-0022).
 */
export const GET = withApi(
  { permission: 'availability:read', query: SlotQuery },
  async ({ actor, params, query }) => ({
    data: await offerSlots(actor, params.doctorId ?? '', query),
  }),
)
