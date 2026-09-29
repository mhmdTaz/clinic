'use client'

import { useId, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import {
  SetDiagnosesRequest,
  issueCode,
  issuePath,
  type Diagnosis,
  type EncounterDetail,
} from '@clinic/contracts'
import { Alert, Button, Checkbox, Input, Spinner } from '@clinic/ui'
import { ApiError, apiFetch } from '@/lib/api/client'
import { useErrorMessage, useValidationMessage } from '@/lib/i18n/use-error-message'
import { useRouter } from '@/lib/navigation/use-router'
import { useDraftSection } from './encounter-drafts'

interface Row {
  key: string
  code: string
  description: string
  isPrimary: boolean
  isChronic: boolean
}

let sequence = 0
const rowKey = () => `diagnosis-${(sequence += 1)}`

const rowsOf = (diagnoses: Diagnosis[]): Row[] =>
  diagnoses.map((diagnosis) => ({
    key: diagnosis.id,
    code: diagnosis.code,
    description: diagnosis.description,
    isPrimary: diagnosis.isPrimary,
    isChronic: diagnosis.isChronic,
  }))

/** What the list says, without the keys React uses to tell the rows apart. */
const contentOf = (list: Row[]) =>
  JSON.stringify(
    list.map(({ code, description, isPrimary, isChronic }) => [
      code,
      description,
      isPrimary,
      isChronic,
    ]),
  )

/**
 * Coding the visit (D7).
 *
 * The list is saved whole, because "which one is primary" is a property of the list rather than
 * of any row in it — and the server normalises that, so two screens cannot end up disagreeing
 * about which diagnosis was the main one.
 */
export function DiagnosisEditor({
  encounterId,
  diagnoses,
  readOnly,
}: {
  encounterId: string
  diagnoses: Diagnosis[]
  readOnly: boolean
}) {
  const t = useTranslations('clinical.diagnoses')
  const tCommon = useTranslations('common')
  const router = useRouter()
  const errorMessage = useErrorMessage()
  const validationMessage = useValidationMessage()
  const fieldId = useId()

  const server = rowsOf(diagnoses)
  /** The server's list as last confirmed — by a save here or by a newer render. */
  const [baseline, setBaseline] = useState<Row[]>(server)
  const [rendered, setRendered] = useState(() => contentOf(server))
  const [rows, setRows] = useState<Row[]>(server)
  const [errors, setErrors] = useState<Record<number, string>>({})
  const [general, setGeneral] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [pending, setPending] = useState(false)
  const inFlight = useRef<Promise<boolean> | null>(null)

  // The list is one decision, so it follows a newer server copy only if untouched here.
  if (contentOf(server) !== rendered) {
    setRendered(contentOf(server))
    if (contentOf(server) !== contentOf(baseline)) {
      if (contentOf(rows) === contentOf(baseline)) setRows(server)
      setBaseline(server)
    }
  }

  const dirty = !readOnly && contentOf(rows) !== contentOf(baseline)

  const drafts = useDraftSection(
    'diagnoses',
    { dirty, saving: pending },
    {
      save: () => save(),
      focus: () => {
        const target =
          document.querySelector<HTMLElement>(`[data-diagnoses="${fieldId}"] input`) ??
          document.getElementById(`${fieldId}-add`)
        target?.scrollIntoView({ block: 'center' })
        target?.focus()
      },
    },
  )

  function change(index: number, patch: Partial<Row>) {
    setRows((current) => current.map((row, at) => (at === index ? { ...row, ...patch } : row)))
    setSaved(false)
    setErrors({})
  }

  /** One primary, chosen by the last person to tick one — the server settles it the same way. */
  function makePrimary(index: number) {
    setRows((current) => current.map((row, at) => ({ ...row, isPrimary: at === index })))
    setSaved(false)
  }

  function report(details: ReadonlyArray<{ field: string; issue: string }>): boolean {
    const placed: Record<number, string> = {}
    let other = false
    for (const detail of details) {
      const match = /^diagnoses\.(\d+)\./.exec(detail.field)
      if (match) placed[Number(match[1])] = validationMessage(detail.issue)
      else other = true
    }
    setErrors(placed)
    return other
  }

  function save(): Promise<boolean> {
    if (inFlight.current) return inFlight.current
    if (!dirty) return Promise.resolve(true)
    setGeneral(null)
    setSaved(false)
    setErrors({})

    const submitted = rows
    const parsed = SetDiagnosesRequest.safeParse({
      diagnoses: submitted
        .filter((row) => row.code.trim() !== '' || row.description.trim() !== '')
        .map((row) => ({
          code: row.code,
          description: row.description,
          isPrimary: row.isPrimary,
          isChronic: row.isChronic,
          notes: null,
        })),
    })
    if (!parsed.success) {
      const other = report(
        parsed.error.issues.map((issue) => ({ field: issuePath(issue), issue: issueCode(issue) })),
      )
      if (other) setGeneral(errorMessage(new ApiError(400, 'VALIDATION_FAILED', '')))
      return Promise.resolve(false)
    }

    const run = (async () => {
      setPending(true)
      try {
        const encounter = await apiFetch<EncounterDetail>(
          `/api/v1/encounters/${encounterId}/diagnoses`,
          { method: 'PUT', body: parsed.data },
        )
        // The server upper-cases codes, drops blank rows and settles the primary: an untouched
        // list becomes exactly what it stored.
        const stored = rowsOf(encounter.diagnoses)
        setRows((current) => (current === submitted ? stored : current))
        setBaseline(stored)
        drafts.confirmed(encounter)
        setSaved(true)
        router.refresh()
        return true
      } catch (caught) {
        const other = caught instanceof ApiError ? report(caught.details) : true
        if (other) setGeneral(errorMessage(caught))
        return false
      } finally {
        setPending(false)
        inFlight.current = null
      }
    })()
    inFlight.current = run
    return run
  }

  if (readOnly) {
    return diagnoses.length === 0 ? (
      <p className="text-muted-foreground text-sm">{t('none')}</p>
    ) : (
      <ul className="flex flex-col gap-1 text-sm">
        {diagnoses.map((diagnosis) => (
          <li key={diagnosis.id}>
            <span className="font-medium tabular-nums">{diagnosis.code}</span> —{' '}
            {diagnosis.description}
            {diagnosis.isPrimary ? (
              <span className="text-muted-foreground"> · {t('primary')}</span>
            ) : null}
          </li>
        ))}
      </ul>
    )
  }

  return (
    <div className="flex flex-col gap-3" data-diagnoses={fieldId}>
      {saved && !dirty ? <Alert tone="success">{t('saved')}</Alert> : null}
      {general ? <Alert tone="danger">{general}</Alert> : null}

      {rows.map((row, index) => (
        <div key={row.key} className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={row.code}
              maxLength={16}
              aria-label={t('code')}
              placeholder="J06.9"
              className="w-28 tabular-nums"
              aria-invalid={Boolean(errors[index]) || undefined}
              onChange={(event) => change(index, { code: event.target.value })}
            />
            <Input
              value={row.description}
              maxLength={200}
              aria-label={t('description')}
              placeholder={t('description')}
              className="min-w-48 flex-1"
              onChange={(event) => change(index, { description: event.target.value })}
            />
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={row.isPrimary}
                onChange={() => makePrimary(index)}
                aria-label={t('primaryFor', { code: row.code || t('code') })}
              />
              {t('primary')}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={row.isChronic}
                onChange={(event) => change(index, { isChronic: event.target.checked })}
                aria-label={t('chronicFor', { code: row.code || t('code') })}
              />
              {t('chronic')}
            </label>
            <Button
              variant="ghost"
              size="sm"
              aria-label={t('remove', { code: row.code || t('code') })}
              onClick={() => {
                setRows((current) => current.filter((_, at) => at !== index))
                setSaved(false)
              }}
            >
              <X className="size-4" aria-hidden="true" />
            </Button>
          </div>
          {errors[index] ? (
            <p className="text-danger text-xs font-medium">{errors[index]}</p>
          ) : null}
        </div>
      ))}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          id={`${fieldId}-add`}
          onClick={() =>
            setRows((current) => [
              ...current,
              {
                key: rowKey(),
                code: '',
                description: '',
                isPrimary: current.length === 0,
                isChronic: false,
              },
            ])
          }
        >
          {t('add')}
        </Button>
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
