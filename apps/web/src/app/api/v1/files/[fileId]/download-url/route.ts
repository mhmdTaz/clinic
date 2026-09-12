import { getDownloadLink } from '@clinic/core/files'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Sixty seconds, and a line in the audit log naming who took it (12.1). */
export const GET = withApi({ permission: 'file:read' }, async ({ actor, params }) => ({
  data: await getDownloadLink(actor, params.fileId ?? ''),
}))
