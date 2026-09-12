'use client'

import { useId, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  UpdateBookingWindowRequest,
  issueCode,
  issuePath,
  type BookingWindow,
} from '@clinic/contracts'
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Spinner,
} from '@clinic/ui'
import { ApiError, apiFetch } from '@/lib/api/client'
import { useErrorMessage, useValidationMessage } from '@/lib/i18n/use-error-message'
import { useRouter } from '@/lib/navigation/use-router'

type Field = keyof BookingWindow

const FIELDS: ReadonlyArray<{ name: Field; min: number; max: number }> = [
  { name: 'horizonDays', min: 1, max: 365 },
  { name: 'minimumNoticeHours', min: 0, max: 168 },
  { name: 'cancellationCutoffHours', min: 0, max: 168 },
]

/**
 * What patients may do for themselves (ADR-0022). These three numbers bind self-service only:
 * the front desk can always book, move or cancel anything, so a strict rule here can never lock
 * the clinic out of its own diary.
 */
export function BookingWindowCard({
  booking,
  canEdit,
}: {
  booking: BookingWindow
  canEdit: boolean
}) {
  const t = useTranslations('admin.clinic.booking')
  const tCommon = useTranslations('common')
  const router = useRouter()
  const errorMessage = useErrorMessage()
  const validationMessage = useValidationMessage()
  const fieldId = useId()

  const [values, setValues] = useState<Record<Field, string>>({
    horizonDays: String(booking.horizonDays),
    minimumNoticeHours: String(booking.minimumNoticeHours),
    cancellationCutoffHours: String(booking.cancellationCutoffHours),
  })
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({})
  const [general, setGeneral] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [pending, setPending] = useState(false)

  const dirty = FIELDS.some(({ name }) => values[name] !== String(booking[name]))

  function report(details: ReadonlyArray<{ field: string; issue: string }>): boolean {
    const placed: Partial<Record<Field, string>> = {}
    let other = false
    for (const detail of details) {
      const field = FIELDS.find((entry) => entry.name === detail.field)
      if (field) placed[field.name] = validationMessage(detail.issue)
      else other = true
    }
    setErrors(placed)
    return other
  }

  async function save() {
    setGeneral(null)
    setSaved(false)
    setErrors({})

    const parsed = UpdateBookingWindowRequest.safeParse(values)
    if (!parsed.success) {
      const other = report(
        parsed.error.issues.map((issue) => ({ field: issuePath(issue), issue: issueCode(issue) })),
      )
      if (other) setGeneral(errorMessage(new ApiError(400, 'VALIDATION_FAILED', '')))
      return
    }

    setPending(true)
    try {
      await apiFetch('/api/v1/admin/clinic/booking-window', { method: 'PUT', body: parsed.data })
      setSaved(true)
      router.refresh()
    } catch (caught) {
      const other = caught instanceof ApiError ? report(caught.details) : true
      if (other) setGeneral(errorMessage(caught))
    } finally {
      setPending(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('subtitle')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {saved ? <Alert tone="success">{tCommon('saved')}</Alert> : null}
        {general ? <Alert tone="danger">{general}</Alert> : null}

        <div className="grid gap-4 sm:grid-cols-3">
          {FIELDS.map(({ name, min, max }) => (
            <div key={name} className="flex flex-col gap-1">
              <Label htmlFor={`${fieldId}-${name}`}>{t(`fields.${name}`)}</Label>
              <Input
                id={`${fieldId}-${name}`}
                type="number"
                inputMode="numeric"
                min={min}
                max={max}
                value={values[name]}
                disabled={!canEdit}
                aria-invalid={Boolean(errors[name]) || undefined}
                aria-describedby={`${fieldId}-${name}-hint`}
                onChange={(event) => {
                  setValues((current) => ({ ...current, [name]: event.target.value }))
                  setSaved(false)
                }}
              />
              <p id={`${fieldId}-${name}-hint`} className="text-muted-foreground text-xs">
                {t(`hints.${name}`)}
              </p>
              {errors[name] ? (
                <p className="text-danger text-xs font-medium">{errors[name]}</p>
              ) : null}
            </div>
          ))}
        </div>

        {canEdit ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => void save()} disabled={pending || !dirty}>
              {pending ? <Spinner /> : null}
              {pending ? tCommon('saving') : tCommon('save')}
            </Button>
            {dirty && !pending ? (
              <span className="text-muted-foreground text-xs">{tCommon('unsaved')}</span>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
