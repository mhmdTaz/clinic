'use client'

import { useId, useState, type FormEvent } from 'react'
import { useTranslations } from 'next-intl'
import { SetHolidaysRequest, issueCode, issuePath, type Holiday } from '@clinic/contracts'
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
  Select,
  Spinner,
} from '@clinic/ui'
import { ApiError, apiFetch } from '@/lib/api/client'
import { formatCalendarDate } from '@/lib/format/dates'
import { useErrorMessage, useValidationMessage } from '@/lib/i18n/use-error-message'
import { useRouter } from '@/lib/navigation/use-router'

/**
 * Closures save as they are added or removed — there is no half-finished list to lose. Past
 * dates stay visible, marked, so a year's closures can be checked afterwards.
 */
export function HolidaysCard({
  holidays,
  branches,
  today,
  locale,
  canEdit,
}: {
  holidays: Holiday[]
  branches: Array<{ id: string; name: string }>
  today: string
  locale: string
  canEdit: boolean
}) {
  const t = useTranslations('admin.clinic.holidays')
  const tCommon = useTranslations('common')
  const router = useRouter()
  const errorMessage = useErrorMessage()
  const validationMessage = useValidationMessage()
  const formId = useId()

  const [date, setDate] = useState('')
  const [name, setName] = useState('')
  const [branchId, setBranchId] = useState('')
  const [fieldErrors, setFieldErrors] = useState<{ date?: string; name?: string }>({})
  const [general, setGeneral] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [pending, setPending] = useState<string | null>(null)

  const multiBranch = branches.length > 1
  const sorted = holidays
    .map((holiday, index) => ({ holiday, index }))
    .sort((a, b) => a.holiday.date.localeCompare(b.holiday.date))
  const branchName = (id: string | null) =>
    id ? (branches.find((branch) => branch.id === id)?.name ?? '') : t('everywhere')

  /** Saves the whole list; errors on the entry being added land beside the add form. */
  async function persist(
    next: Holiday[],
    addedIndex: number | null,
    marker: string,
  ): Promise<boolean> {
    setGeneral(null)
    setSaved(false)
    setFieldErrors({})

    const report = (details: ReadonlyArray<{ field: string; issue: string }>) => {
      const own: { date?: string; name?: string } = {}
      let other = false
      for (const detail of details) {
        const match = /^holidays\.(\d+)\.(date|name)/.exec(detail.field)
        if (match && addedIndex !== null && Number(match[1]) === addedIndex) {
          own[match[2] as 'date' | 'name'] = validationMessage(detail.issue)
        } else {
          other = true
        }
      }
      setFieldErrors(own)
      return other
    }

    const parsed = SetHolidaysRequest.safeParse({ holidays: next })
    if (!parsed.success) {
      const other = report(
        parsed.error.issues.map((issue) => ({ field: issuePath(issue), issue: issueCode(issue) })),
      )
      if (other) setGeneral(errorMessage(new ApiError(400, 'VALIDATION_FAILED', '')))
      return false
    }

    setPending(marker)
    try {
      await apiFetch('/api/v1/admin/clinic/holidays', { method: 'PUT', body: parsed.data })
      setSaved(true)
      router.refresh()
      return true
    } catch (caught) {
      const other = caught instanceof ApiError ? report(caught.details) : true
      if (other) setGeneral(errorMessage(caught))
      return false
    } finally {
      setPending(null)
    }
  }

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const next = [...holidays, { date, name, branchId: branchId || null }]
    if (await persist(next, next.length - 1, 'add')) {
      setDate('')
      setName('')
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('subtitle')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {saved ? <Alert tone="success">{t('saved')}</Alert> : null}
        {general ? <Alert tone="danger">{general}</Alert> : null}

        {sorted.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('empty')}</p>
        ) : (
          <ul className="divide-border flex flex-col divide-y">
            {sorted.map(({ holiday, index }) => {
              const past = holiday.date < today
              return (
                <li
                  key={`${holiday.date}-${holiday.branchId ?? 'all'}`}
                  className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className={past ? 'text-muted-foreground' : undefined}>
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      {holiday.name}
                      {past ? <Badge tone="neutral">{t('past')}</Badge> : null}
                    </p>
                    <p className="text-sm">
                      {formatCalendarDate(holiday.date, locale, 'full')}
                      {multiBranch ? ` · ${branchName(holiday.branchId)}` : null}
                    </p>
                  </div>
                  {canEdit ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="self-start sm:self-auto"
                      disabled={pending !== null}
                      aria-label={t('remove', { name: holiday.name })}
                      onClick={() =>
                        void persist(
                          holidays.filter((_, position) => position !== index),
                          null,
                          `remove-${index}`,
                        )
                      }
                    >
                      {pending === `remove-${index}` ? <Spinner /> : null}
                      {tCommon('remove')}
                    </Button>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}

        {canEdit ? (
          <form
            onSubmit={add}
            noValidate
            className="border-border flex flex-col gap-3 border-t pt-4 sm:flex-row sm:flex-wrap sm:items-end"
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor={`${formId}-date`}>{t('date')}</Label>
              <Input
                id={`${formId}-date`}
                type="date"
                value={date}
                required
                className="sm:w-44"
                aria-invalid={Boolean(fieldErrors.date) || undefined}
                aria-describedby={fieldErrors.date ? `${formId}-date-error` : undefined}
                onChange={(event) => setDate(event.target.value)}
              />
              {fieldErrors.date ? (
                <p id={`${formId}-date-error`} className="text-danger text-xs font-medium">
                  {fieldErrors.date}
                </p>
              ) : null}
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <Label htmlFor={`${formId}-name`}>{t('name')}</Label>
              <Input
                id={`${formId}-name`}
                value={name}
                required
                maxLength={80}
                placeholder={t('namePlaceholder')}
                aria-invalid={Boolean(fieldErrors.name) || undefined}
                aria-describedby={fieldErrors.name ? `${formId}-name-error` : undefined}
                onChange={(event) => setName(event.target.value)}
              />
              {fieldErrors.name ? (
                <p id={`${formId}-name-error`} className="text-danger text-xs font-medium">
                  {fieldErrors.name}
                </p>
              ) : null}
            </div>
            {multiBranch ? (
              <div className="flex flex-col gap-2 sm:w-48">
                <Label htmlFor={`${formId}-branch`}>{t('location')}</Label>
                <Select
                  id={`${formId}-branch`}
                  value={branchId}
                  onChange={(event) => setBranchId(event.target.value)}
                >
                  <option value="">{t('everywhere')}</option>
                  {branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name}
                    </option>
                  ))}
                </Select>
              </div>
            ) : null}
            <Button type="submit" disabled={pending !== null} className="self-start sm:self-auto">
              {pending === 'add' ? <Spinner /> : null}
              {t('add')}
            </Button>
          </form>
        ) : null}
      </CardContent>
    </Card>
  )
}
