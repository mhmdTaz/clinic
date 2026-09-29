'use client'

import { useId, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { UpdateEncounterRequest, type ClinicalNote, type EncounterDetail } from '@clinic/contracts'
import { Alert, Button, Checkbox, Label, Spinner, Textarea } from '@clinic/ui'
import { ApiError, apiFetch } from '@/lib/api/client'
import { useErrorMessage } from '@/lib/i18n/use-error-message'
import { useRouter } from '@/lib/navigation/use-router'
import { useDraftSection } from './encounter-drafts'

const SECTIONS = ['subjective', 'objective', 'assessment', 'plan'] as const
type Section = (typeof SECTIONS)[number]

interface NoteState {
  text: Record<Section, string>
  shared: boolean
}

const noteStateOf = (note: ClinicalNote): NoteState => ({
  text: {
    subjective: note.subjective ?? '',
    objective: note.objective ?? '',
    assessment: note.assessment ?? '',
    plan: note.plan ?? '',
  },
  shared: note.isPatientVisible,
})

const sameNote = (a: NoteState, b: NoteState) =>
  a.shared === b.shared && SECTIONS.every((section) => a.text[section] === b.text[section])

/**
 * The server's copy moved from `before` to `after` (a save here, or a refresh after one made
 * elsewhere). Whatever was not touched here follows the server; whatever was typed here stays.
 */
function rebase(draft: NoteState, before: NoteState, after: NoteState): NoteState {
  return {
    text: Object.fromEntries(
      SECTIONS.map((section) => [
        section,
        draft.text[section] === before.text[section] ? after.text[section] : draft.text[section],
      ]),
    ) as Record<Section, string>,
    shared: draft.shared === before.shared ? after.shared : draft.shared,
  }
}

/**
 * The SOAP note (D6), while it is still a draft.
 *
 * Saving is explicit. An autosaving clinical note sounds kind until you picture the alternative
 * failure: a half-typed differential written to the record because focus moved. Instead, nothing
 * typed here can be lost quietly or signed unseen (audit F01, F02): the visit's drafts refuse
 * signing and ask before leaving while this section holds anything the server does not.
 */
export function NoteEditor({
  encounterId,
  note,
  canShare,
}: {
  encounterId: string
  note: ClinicalNote
  canShare: boolean
}) {
  const t = useTranslations('clinical.note')
  const tCommon = useTranslations('common')
  const router = useRouter()
  const errorMessage = useErrorMessage()
  const fieldId = useId()

  const server = noteStateOf(note)
  /** The server's copy as last confirmed — by a save here or by a newer render. */
  const [baseline, setBaseline] = useState(server)
  const [rendered, setRendered] = useState(server)
  const [draft, setDraft] = useState(server)
  const [saved, setSaved] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inFlight = useRef<Promise<boolean> | null>(null)

  // A new server render. Usually it only repeats what a save here already confirmed; when it
  // does not, someone saved elsewhere, and the untouched sections follow.
  if (!sameNote(server, rendered)) {
    setRendered(server)
    if (!sameNote(server, baseline)) {
      setDraft(rebase(draft, baseline, server))
      setBaseline(server)
    }
  }

  const dirty = !sameNote(draft, baseline)

  const drafts = useDraftSection(
    'note',
    { dirty, saving: pending },
    {
      save: () => save(),
      focus: () => {
        const first = SECTIONS.find((section) => draft.text[section] !== baseline.text[section])
        const target = document.getElementById(`${fieldId}-${first ?? 'subjective'}`)
        target?.scrollIntoView({ block: 'center' })
        target?.focus()
      },
    },
  )

  function save(): Promise<boolean> {
    if (inFlight.current) return inFlight.current
    if (!dirty) return Promise.resolve(true)
    const submitted = draft
    const run = (async () => {
      setPending(true)
      setError(null)
      setSaved(false)
      try {
        const parsed = UpdateEncounterRequest.safeParse({
          note: Object.fromEntries(
            SECTIONS.map((section) => [section, submitted.text[section] || null]),
          ),
          isNoteVisibleToPatient: submitted.shared,
        })
        if (!parsed.success) throw new ApiError(400, 'VALIDATION_FAILED', '')
        const encounter = await apiFetch<EncounterDetail>(`/api/v1/encounters/${encounterId}`, {
          method: 'PATCH',
          body: parsed.data,
        })
        // The server trims what it stores; what was sent and not touched since becomes exactly
        // what it answered, so a saved note never still reads as unsaved.
        const stored = noteStateOf(encounter.note)
        setDraft((current) => rebase(current, submitted, stored))
        setBaseline(stored)
        drafts.confirmed(encounter)
        setSaved(true)
        router.refresh()
        return true
      } catch (caught) {
        setError(errorMessage(caught))
        return false
      } finally {
        setPending(false)
        inFlight.current = null
      }
    })()
    inFlight.current = run
    return run
  }

  return (
    <div className="flex flex-col gap-4">
      {saved && !dirty ? <Alert tone="success">{t('saved')}</Alert> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}

      {SECTIONS.map((section) => (
        <div key={section} className="flex flex-col gap-2">
          <Label htmlFor={`${fieldId}-${section}`}>{t(`sections.${section}`)}</Label>
          <Textarea
            id={`${fieldId}-${section}`}
            rows={section === 'subjective' || section === 'plan' ? 4 : 3}
            maxLength={5000}
            value={draft.text[section]}
            placeholder={t(`hints.${section}`)}
            onChange={(event) => {
              const value = event.target.value
              setDraft((current) => ({ ...current, text: { ...current.text, [section]: value } }))
              setSaved(false)
            }}
          />
        </div>
      ))}

      {canShare ? (
        <label className="flex items-start gap-3 text-sm">
          <Checkbox
            checked={draft.shared}
            className="mt-0.5"
            onChange={(event) => {
              const shared = event.target.checked
              setDraft((current) => ({ ...current, shared }))
              setSaved(false)
            }}
          />
          <span>
            <span className="font-medium">{t('shareWithPatient')}</span>
            <span className="text-muted-foreground block text-xs">{t('shareHint')}</span>
          </span>
        </label>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={pending || !dirty} onClick={() => void save()}>
          {pending ? <Spinner /> : null}
          {pending ? tCommon('saving') : t('save')}
        </Button>
        {dirty && !pending ? (
          <span className="text-muted-foreground text-xs" role="status">
            {tCommon('unsaved')}
          </span>
        ) : null}
      </div>
    </div>
  )
}
