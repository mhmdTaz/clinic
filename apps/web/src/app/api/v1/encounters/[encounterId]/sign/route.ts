import { SignNoteRequest } from '@clinic/contracts'
import { signNote } from '@clinic/core/clinical'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Signing freezes the note's content for good; corrections become addenda (D9, ADR-0024). */
export const POST = withApi(
  { permission: 'encounter:sign', body: SignNoteRequest },
  async ({ actor, body, params }) => ({
    data: await signNote(actor, params.encounterId ?? '', body),
  }),
)
