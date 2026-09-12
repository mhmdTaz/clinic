import { ConfirmUploadRequest } from '@clinic/contracts'
import { confirmUpload } from '@clinic/core/files'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Step 4 of section 12.1. A presigned PUT succeeds without telling us, so the client says so —
 * and the server checks the object's first bytes rather than believing the declared type.
 */
export const POST = withApi(
  { permission: 'file:upload', body: ConfirmUploadRequest },
  async ({ actor, body, params }) => ({
    data: await confirmUpload(actor, params.fileId ?? '', body),
  }),
)
