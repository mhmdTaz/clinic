import { PresignUploadRequest } from '@clinic/contracts'
import { presignUpload } from '@clinic/core/files'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Step 1 of section 12.1. The permission check happens here, before any URL exists: a presigned
 * URL is a bearer credential, and handing one out is the act being authorised.
 */
export const POST = withApi(
  { permission: 'file:upload', body: PresignUploadRequest },
  async ({ actor, body }) => ({ status: 201, data: await presignUpload(actor, body) }),
)
