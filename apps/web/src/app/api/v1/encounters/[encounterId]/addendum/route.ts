import { AddendumRequest } from '@clinic/contracts'
import { addAddendum } from '@clinic/core/clinical'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** The only way to change a signed record: appended beneath it, never over it. */
export const POST = withApi(
  { permission: 'encounter:sign', body: AddendumRequest },
  async ({ actor, body, params }) => ({
    status: 201,
    data: await addAddendum(actor, params.encounterId ?? '', body),
  }),
)
