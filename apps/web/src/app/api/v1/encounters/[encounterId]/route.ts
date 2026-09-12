import { UpdateEncounterRequest } from '@clinic/contracts'
import { getEncounter, updateEncounter } from '@clinic/core/clinical'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** The note's text is left out for anyone it was not shared with (ADR-0025). */
export const GET = withApi({ permission: 'encounter:read' }, async ({ actor, params }) => ({
  data: await getEncounter(actor, params.encounterId ?? ''),
}))

/** Writing the note. A signed note refuses every part of this but who may read it (ADR-0024). */
export const PATCH = withApi(
  { permission: 'encounter:write', body: UpdateEncounterRequest },
  async ({ actor, body, params }) => ({
    data: await updateEncounter(actor, params.encounterId ?? '', body),
  }),
)
