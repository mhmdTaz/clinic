import { completeEncounter } from '@clinic/core/clinical'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** The visit is over. Separate from signing: the note may still be written up afterwards. */
export const POST = withApi({ permission: 'encounter:write' }, async ({ actor, params }) => ({
  data: await completeEncounter(actor, params.encounterId ?? ''),
}))
