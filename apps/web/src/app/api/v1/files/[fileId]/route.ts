import { UpdateFileRequest } from '@clinic/contracts'
import { deleteFile, updateFile } from '@clinic/core/files'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** What a document is, and who may see it. Sharing is audited in both directions (ADR-0025). */
export const PATCH = withApi(
  { permission: 'file:upload', body: UpdateFileRequest },
  async ({ actor, body, params }) => ({
    data: await updateFile(actor, params.fileId ?? '', body),
  }),
)

/** Soft delete: a clinical document is never destroyed inside the retention window (12.3). */
export const DELETE = withApi({ permission: 'file:delete' }, async ({ actor, params }) => {
  await deleteFile(actor, params.fileId ?? '')
  return { data: { ok: true } }
})
