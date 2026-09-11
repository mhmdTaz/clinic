import { getPermissionCatalogue } from '@clinic/core/access'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** The permission catalogue the matrix renders from — keys, groups and flags, no labels. */
export const GET = withApi({ permission: 'portal.admin:access' }, async ({ actor }) => ({
  data: await getPermissionCatalogue(actor),
}))
