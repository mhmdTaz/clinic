import { ReplyToTicketRequest } from '@clinic/contracts'
import { replyToTicket } from '@clinic/core/support'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * A reply, public or internal. `isInternal` is refused for anybody who is not clinic-side rather
 * than silently downgraded — a patient whose note was quietly published would never know.
 */
export const POST = withApi(
  { permission: 'ticket:reply', body: ReplyToTicketRequest },
  async ({ actor, body, params }) => ({
    status: 201,
    data: await replyToTicket(actor, params.ticketId ?? '', body),
  }),
)
