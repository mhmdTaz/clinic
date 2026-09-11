import { AcceptInvitationRequest } from '@clinic/contracts'
import { acceptInvitation } from '@clinic/core/session'
import { sessionResult } from '@/lib/api/session-result'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = withApi(
  { auth: 'none', body: AcceptInvitationRequest },
  async ({ body, meta }) => {
    const session = await acceptInvitation({ token: body.token, password: body.password, meta })
    return sessionResult(session, body.tokenDelivery)
  },
)
