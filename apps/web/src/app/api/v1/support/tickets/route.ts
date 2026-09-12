import { OpenTicketRequest, TicketListQuery } from '@clinic/contracts'
import { listTickets, openTicket } from '@clinic/core/support'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Everyone's view of the same endpoint. The clinic gets an inbox and everybody else gets the
 * tickets they opened — narrowed in the use case, not by the caller passing a filter.
 */
export const GET = withApi(
  { permission: 'ticket:read', query: TicketListQuery },
  async ({ actor, query }) => ({ data: await listTickets(actor, query) }),
)

export const POST = withApi(
  { permission: 'ticket:create', body: OpenTicketRequest },
  async ({ actor, body }) => ({ status: 201, data: await openTicket(actor, body) }),
)
