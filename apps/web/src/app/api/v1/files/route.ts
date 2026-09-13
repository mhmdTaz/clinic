import { FileListQuery } from '@clinic/contracts'
import { listFiles } from '@clinic/core/files'
import { paged } from '@/lib/api/paged'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** The document vault (P6) and a chart's attachments (S14, D6), scoped to who is asking. */
export const GET = withApi(
  { permission: 'file:read', query: FileListQuery },
  async ({ actor, query }) => paged(await listFiles(actor, query)),
)
