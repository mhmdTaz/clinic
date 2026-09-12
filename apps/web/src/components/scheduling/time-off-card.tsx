'use client'

import { useId, useState, type FormEvent } from 'react'
import { useTranslations } from 'next-intl'
import { TimeOffInput, issueCode, issuePath, type TimeOff } from '@clinic/contracts'
import {
  Alert,
  Badge,
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
import { formatCalendarDate } from '@/lib/format/dates'
import { useErrorMessage, useValidationMessage } from '@/lib/i18n/use-error-message'
import { useRouter } from '@/lib/navigation/use-router'

/**
 * Days the doctor is away (D10). Both ends are inclusive and read as calendar dates in the
 * clinic's zone, so a single day off is the same date twice.
 *
 * Adding time off does not move appointments already booked into those days — the clinic decides
 * what happens to each — but no new one can be booked there while it stands.
 */
export function TimeOffCard({
  doctorId,
  entries,
  today,
  locale,
  canEdit,
}: {
  doctorId: string
  entries: TimeOff[]
  today: string
  locale: string
  canEdit: boolean
}) {
  const t = useTranslations('scheduling.timeOff')
  const tCommon = useTranslations('common')
  const router = useRouter()
  const errorMessage = useErrorMessage()
  const validationMessage = useValidationMessage()
  const fieldId = useId()

  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [reason, setReason] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [general, setGeneral] = useState<string | null>(null)
  const [pending, setPending] = useState<string | null>(null)

  const sorted = [...entries].sort((a, b) => a.startDate.localeCompare(b.startDate))

  function report(details: ReadonlyArray<{ field: string; issue: string }>): boolean {
    const placed: Record<string, string> = {}
    let other = false
    for (const detail of details) {
      if (detail.field === 'startDate' || detail.field === 'endDate' || detail.field === 'reason') {
        placed[detail.field] = validationMessage(detail.issue)
      } else {
        other = true
      }
    }
    setFieldErrors(placed)
    return other
  }

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setGeneral(null)
    setFieldErrors({})

    const parsed = TimeOffInput.safeParse({
      startDate,
      // One day off is the same day at both ends; the second field may simply be left alone.
      endDate: endDate || startDate,
      reason: reason.trim() || null,
    })
    if (!parsed.success) {
      const other = report(
        parsed.error.issues.map((issue) => ({ field: issuePath(issue), issue: issueCode(issue) })),
      )
      if (other) setGeneral(errorMessage(new ApiError(400, 'VALIDATION_FAILED', '')))
      return
    }

    setPending('add')
    try {
      await apiFetch(`/api/v1/doctors/${doctorId}/time-off`, { method: 'POST', body: parsed.data })
      setStartDate('')
      setEndDate('')
      setReason('')
      router.refresh()
    } catch (caught) {
      const other = caught instanceof ApiError ? report(caught.details) : true
      if (other) setGeneral(errorMessage(caught))
    } finally {
      setPending(null)
    }
  }

  async function remove(timeOffId: string) {
    setGeneral(null)
    setPending(timeOffId)
    try {
      await apiFetch(`/api/v1/doctors/${doctorId}/time-off/${timeOffId}`, { method: 'DELETE' })
      router.refresh()
    } catch (caught) {
      setGeneral(errorMessage(caught))
    } finally {
      setPending(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('subtitle')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {general ? <Alert tone="danger">{general}</Alert> : null}

        {sorted.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('none')}</p>
        ) : (
          <ul className="divide-border flex flex-col divide-y">
            {sorted.map((entry) => {
              const past = entry.endDate < today
              const dates =
                entry.startDate === entry.endDate
                  ? formatCalendarDate(entry.startDate, locale)
                  : `${formatCalendarDate(entry.startDate, locale)} – ${formatCalendarDate(entry.endDate, locale)}`
              return (
                <li
                  key={entry.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-3"
                >
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      {dates}
                      {past ? <Badge tone="neutral">{t('past')}</Badge> : null}
                    </span>
                    {entry.reason ? (
                      <span className="text-muted-foreground text-xs break-words">
                        {entry.reason}
                      </span>
                    ) : null}
                  </span>
                  {canEdit ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={pending !== null}
                      aria-label={t('removeLabel', { dates })}
                      onClick={() => void remove(entry.id)}
                    >
                      {pending === entry.id ? <Spinner /> : null}
                      {tCommon('remove')}
                    </Button>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}

        {canEdit ? (
          <form onSubmit={(event) => void add(event)} className="flex flex-col gap-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="flex flex-col gap-1">
                <Label htmlFor={`${fieldId}-start`}>{t('startDate')}</Label>
                <Input
                  id={`${fieldId}-start`}
                  type="date"
                  required
                  value={startDate}
                  aria-invalid={Boolean(fieldErrors.startDate) || undefined}
                  onChange={(event) => setStartDate(event.target.value)}
                />
                {fieldErrors.startDate ? (
                  <p className="text-danger text-xs font-medium">{fieldErrors.startDate}</p>
                ) : null}
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor={`${fieldId}-end`}>
                  {t('endDate')}{' '}
                  <span className="text-muted-foreground">({tCommon('optional')})</span>
                </Label>
                <Input
                  id={`${fieldId}-end`}
                  type="date"
                  value={endDate}
                  min={startDate || undefined}
                  aria-invalid={Boolean(fieldErrors.endDate) || undefined}
                  onChange={(event) => setEndDate(event.target.value)}
                />
                {fieldErrors.endDate ? (
                  <p className="text-danger text-xs font-medium">{fieldErrors.endDate}</p>
                ) : null}
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor={`${fieldId}-reason`}>
                  {tCommon('reason')}{' '}
                  <span className="text-muted-foreground">({tCommon('optional')})</span>
                </Label>
                <Input
                  id={`${fieldId}-reason`}
                  value={reason}
                  maxLength={200}
                  onChange={(event) => setReason(event.target.value)}
                />
              </div>
            </div>
            <Button type="submit" className="self-start" disabled={pending !== null || !startDate}>
              {pending === 'add' ? <Spinner /> : null}
              {t('add')}
            </Button>
          </form>
        ) : null}
      </CardContent>
    </Card>
  )
}
