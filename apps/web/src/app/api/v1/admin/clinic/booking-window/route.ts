import { UpdateBookingWindowRequest } from '@clinic/contracts'
import { updateBookingWindow } from '@clinic/core/clinic'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * How far ahead patients may book, how close to the start, and how late they may still change
 * it (ADR-0022). The window is returned with the rest of the settings, so there is no separate
 * GET for it.
 */
export const PUT = withApi(
  { permission: 'clinic:update', body: UpdateBookingWindowRequest },
  async ({ actor, body }) => ({ data: await updateBookingWindow(actor, body) }),
)
