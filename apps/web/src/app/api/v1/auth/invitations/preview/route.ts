import { InvitationPreviewRequest } from '@clinic/contracts'
import { previewActivation } from '@clinic/core/session'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** POST, not GET: the token travels in the body so it never lands in an access log. */
export const POST = withApi(
  { auth: 'none', body: InvitationPreviewRequest },
  async ({ body, meta }) => ({ data: await previewActivation({ token: body.token, meta }) }),
)
