'use client'

import { useId, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  VitalsInput,
  issueCode,
  issuePath,
  type EncounterDetail,
  type Vitals,
} from '@clinic/contracts'
import { Alert, Button, Input, Label, Spinner } from '@clinic/ui'
import { ApiError, apiFetch } from '@/lib/api/client'
import { useErrorMessage, useValidationMessage } from '@/lib/i18n/use-error-message'
import { useRouter } from '@/lib/navigation/use-router'
import { useDraftSection } from './encounter-drafts'

/** Decimal measurements keep their decimal; the rest are whole numbers by nature. */
const FIELDS = [
  { name: 'heightCm', decimal: true, unit: 'cm' },
  { name: 'weightKg', decimal: true, unit: 'kg' },
  { name: 'temperatureC', decimal: true, unit: '°C' },
  { name: 'systolicMmHg', decimal: false, unit: 'mmHg' },
  { name: 'diastolicMmHg', decimal: false, unit: 'mmHg' },
  { name: 'heartRateBpm', decimal: false, unit: 'bpm' },
  { name: 'respiratoryRate', decimal: false, unit: '/min' },
  { name: 'oxygenSaturation', decimal: false, unit: '%' },
  { name: 'bloodGlucose', decimal: true, unit: 'mmol/L' },
] as const

type FieldName = (typeof FIELDS)[number]['name']
type Values = Record<FieldName, string>

const valuesOf = (vitals: Vitals | null): Values =>
  Object.fromEntries(
    FIELDS.map((field) => [field.name, String(vitals?.[field.name] ?? '')]),
  ) as Values

const same = (a: Values, b: Values) => FIELDS.every((field) => a[field.name] === b[field.name])

/** Fields untouched here follow the server from `before` to `after`; typed ones stay. */
const rebase = (draft: Values, before: Values, after: Values): Values =>
  Object.fromEntries(
    FIELDS.map((field) => [
      field.name,
      draft[field.name] === before[field.name] ? after[field.name] : draft[field.name],
    ]),
  ) as Values

/**
 * What was measured during the visit (D6).
 *
 * Every field is optional: a clinician records what they took, not a form's idea of a complete
 * set. The decimal ones travel as strings for the same reason money does — "36.6" typed by a
 * person should come back as "36.6", not as the nearest float to it.
 */
export function VitalsForm({
  encounterId,
  vitals,
  readOnly,
}: {
  encounterId: string
  vitals: Vitals | null
  readOnly: boolean
}) {
  const t = useTranslations('clinical.vitals')
  const tCommon = useTranslations('common')
  const router = useRouter()
  const errorMessage = useErrorMessage()
  const validationMessage = useValidationMessage()
  const fieldId = useId()

  const server = valuesOf(vitals)
  /** The server's copy as last confirmed — by a save here or by a newer render. */
  const [baseline, setBaseline] = useState(server)
  const [rendered, setRendered] = useState(server)
  const [values, setValues] = useState(server)
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({})
  const [general, setGeneral] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [pending, setPending] = useState(false)
  const inFlight = useRef<Promise<boolean> | null>(null)

  if (!same(server, rendered)) {
    setRendered(server)
    if (!same(server, baseline)) {
      setValues(rebase(values, baseline, server))
      setBaseline(server)
    }
  }

  const dirty = !readOnly && !same(values, baseline)

  const drafts = useDraftSection(
    'vitals',
    { dirty, saving: pending },
    {
      save: () => save(),
      focus: () => {
        const first = FIELDS.find((field) => values[field.name] !== baseline[field.name])
        const target = document.getElementById(`${fieldId}-${first?.name ?? FIELDS[0].name}`)
        target?.scrollIntoView({ block: 'center' })
        target?.focus()
      },
    },
  )

  function report(details: ReadonlyArray<{ field: string; issue: string }>): boolean {
    const placed: Partial<Record<FieldName, string>> = {}
    let other = false
    for (const detail of details) {
      const field = FIELDS.find((entry) => entry.name === detail.field)
      if (field) placed[field.name] = validationMessage(detail.issue)
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

    const submitted = values
    const parsed = VitalsInput.safeParse(submitted)
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
          `/api/v1/encounters/${encounterId}/vitals`,
          { method: 'POST', body: parsed.data },
        )
        // "036.6" is stored as 36.6: what was sent and not touched since becomes the server's.
        const stored = valuesOf(encounter.vitals)
        setValues((current) => rebase(current, submitted, stored))
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

  return (
    <div className="flex flex-col gap-4">
      {saved && !dirty ? <Alert tone="success">{t('saved')}</Alert> : null}
      {general ? <Alert tone="danger">{general}</Alert> : null}

      <div className="grid gap-3 sm:grid-cols-3">
        {FIELDS.map((field) => (
          <div key={field.name} className="flex flex-col gap-1">
            <Label htmlFor={`${fieldId}-${field.name}`}>
              {t(`fields.${field.name}`)}{' '}
              <span className="text-muted-foreground text-xs">({field.unit})</span>
            </Label>
            <Input
              id={`${fieldId}-${field.name}`}
              inputMode="decimal"
              value={values[field.name]}
              disabled={readOnly}
              aria-invalid={Boolean(errors[field.name]) || undefined}
              className="tabular-nums"
              onChange={(event) => {
                setValues((current) => ({ ...current, [field.name]: event.target.value }))
                setSaved(false)
              }}
            />
            {errors[field.name] ? (
              <p className="text-danger text-xs font-medium">{errors[field.name]}</p>
            ) : null}
          </div>
        ))}
      </div>

      {readOnly ? null : (
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
      )}
    </div>
  )
}
