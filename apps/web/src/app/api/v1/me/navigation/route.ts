import { MeNavigationQuery } from '@clinic/contracts'
import { getMyNavigation } from '@clinic/core/session'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** The same definition the web sidebar renders, so the mobile tab bar cannot drift from it. */
export const GET = withApi({ query: MeNavigationQuery }, async ({ actor, query }) => ({
  data: await getMyNavigation(actor, query.portal),
}))
