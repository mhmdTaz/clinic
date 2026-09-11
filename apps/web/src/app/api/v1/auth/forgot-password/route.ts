import { ForgotPasswordRequest } from '@clinic/contracts'
import { forgotPassword } from '@clinic/core/session'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Always 202, whether or not the address matched an account. */
export const POST = withApi(
  { auth: 'none', body: ForgotPasswordRequest },
  async ({ body, meta }) => {
    await forgotPassword({ email: body.email, meta })
    return { status: 202, data: { accepted: true as const } }
  },
)
