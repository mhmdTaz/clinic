'use client'

import { useId, useState } from 'react'
import { useTranslations } from 'next-intl'
import { UpdateEncounterRequest, type ClinicalNote } from '@clinic/contracts'
import { Alert, Button, Checkbox, Label, Spinner, Textarea } from '@clinic/ui'
import { ApiError, apiFetch } from '@/lib/api/client'
import { useErrorMessage } from '@/lib/i18n/use-error-message'
import { useRouter } from '@/lib/navigation/use-router'

const SECTIONS = ['subjective', 'objective', 'assessment', 'plan'] as const
type Section = (typeof SECTIONS)[number]

/**
 * The SOAP note (D6), while it is still a draft.
 *
 * Saving is explicit. An autosaving clinical note sounds kind until you picture the alternative
 * failure: a half-typed differential written to the record because focus moved. The unsaved
 * warning does the same job without the risk.
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

  const stored: Record<Section, string> = {
    subjective: note.subjective ?? '',
    objective: note.objective ?? '',
    assessment: note.assessment ?? '',
    plan: note.plan ?? '',
  }
  const [draft, setDraft] = useState(stored)
  const [shared, setShared] = useState(note.isPatientVisible)
  const [saved, setSaved] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const dirty =
    SECTIONS.some((section) => draft[section] !== stored[section]) ||
    shared !== note.isPatientVisible

  async function save() {
    setPending(true)
    setError(null)
    setSaved(false)
    try {
      const parsed = UpdateEncounterRequest.safeParse({
        note: Object.fromEntries(SECTIONS.map((section) => [section, draft[section] || null])),
        isNoteVisibleToPatient: shared,
      })
      if (!parsed.success) throw new ApiError(400, 'VALIDATION_FAILED', '')
      await apiFetch(`/api/v1/encounters/${encounterId}`, { method: 'PATCH', body: parsed.data })
      setSaved(true)
      router.refresh()
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setPending(false)
    }
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
            value={draft[section]}
            placeholder={t(`hints.${section}`)}
            onChange={(event) => {
              setDraft((current) => ({ ...current, [section]: event.target.value }))
              setSaved(false)
            }}
          />
        </div>
      ))}

      {canShare ? (
        <label className="flex items-start gap-3 text-sm">
          <Checkbox
            checked={shared}
            className="mt-0.5"
            onChange={(event) => {
              setShared(event.target.checked)
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
          <span className="text-muted-foreground text-xs">{tCommon('unsaved')}</span>
        ) : null}
      </div>
    </div>
  )
}
