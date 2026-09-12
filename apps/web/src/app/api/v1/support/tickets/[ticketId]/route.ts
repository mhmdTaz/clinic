import { UpdateTicketRequest } from '@clinic/contracts'
import { getTicket, updateTicket } from '@clinic/core/support'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = withApi({ permission: 'ticket:read' }, async ({ actor, params }) => ({
  data: await getTicket(actor, params.ticketId ?? ''),
}))

/** Triage: status, priority, category, assignee. Clinic-side only. */
export const PATCH = withApi(
  { permission: 'ticket:manage', body: UpdateTicketRequest },
  async ({ actor, body, params }) => ({
    data: await updateTicket(actor, params.ticketId ?? '', body),
  }),
)
