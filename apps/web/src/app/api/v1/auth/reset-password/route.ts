import { ResetPasswordRequest } from '@clinic/contracts'
import { resetForgottenPassword } from '@clinic/core/session'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = withApi(
  { auth: 'none', body: ResetPasswordRequest },
  async ({ body, meta }) => {
    await resetForgottenPassword({ token: body.token, password: body.password, meta })
    return { data: { accepted: true as const } }
  },
)
