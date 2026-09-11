import { getMyPermissions } from '@clinic/core/session'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = withApi({}, async ({ actor }) => ({ data: await getMyPermissions(actor) }))
