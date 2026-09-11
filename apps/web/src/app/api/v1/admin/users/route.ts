import { UserListQuery } from '@clinic/contracts'
import { listUsers } from '@clinic/core/users'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** A page of the user directory; meta.nextCursor fetches the next one (section 9.2). */
export const GET = withApi(
  { permission: 'portal.admin:access', query: UserListQuery },
  async ({ actor, query }) => {
    const page = await listUsers(actor, query)
    return {
      data: page.items,
      meta: { nextCursor: page.nextCursor, hasMore: page.nextCursor !== null },
    }
  },
)
