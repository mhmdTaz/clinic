import { UpdateUserRequest } from '@clinic/contracts'
import { getUser, updateUser } from '@clinic/core/users'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = withApi({ permission: 'portal.admin:access' }, async ({ actor, params }) => ({
  data: await getUser(actor, params.userId ?? ''),
}))

export const PUT = withApi(
  { permission: 'portal.admin:access', body: UpdateUserRequest },
  async ({ actor, body, params }) => ({
    data: await updateUser(actor, params.userId ?? '', body),
  }),
)
