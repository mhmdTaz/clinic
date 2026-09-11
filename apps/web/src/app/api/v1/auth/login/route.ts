import { LoginRequest } from '@clinic/contracts'
import { login } from '@clinic/core/session'
import { sessionResult } from '@/lib/api/session-result'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = withApi({ auth: 'none', body: LoginRequest }, async ({ body, meta }) => {
  const session = await login({
    email: body.email,
    password: body.password,
    meta: { ...meta, deviceName: body.deviceName ?? null },
  })
  return sessionResult(session, body.tokenDelivery)
})
