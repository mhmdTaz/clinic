import { InviteUserRequest } from '@clinic/contracts'
import { inviteUser } from '@clinic/core/users'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Creates the account and emails the activation link. `invitationSent: false` means the account
 * exists but the email did not go out — the caller offers a resend rather than an error.
 */
export const POST = withApi(
  { permission: 'portal.admin:access', body: InviteUserRequest },
  async ({ actor, body }) => ({ status: 201, data: await inviteUser(actor, body) }),
)
