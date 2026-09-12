'use client'

import { useId, useState } from 'react'
import { useTranslations } from 'next-intl'
import { BookOwnAppointmentRequest } from '@clinic/contracts'
import { Alert, Button, Card, CardContent, Input, Label, Select, Spinner } from '@clinic/ui'
import { SlotPicker } from '@/components/scheduling/slot-picker'
import { ApiError, apiFetch } from '@/lib/api/client'
import { formatCalendarDate, shiftDate } from '@/lib/format/dates'
import { useErrorMessage } from '@/lib/i18n/use-error-message'
import { useRouter } from '@/lib/navigation/use-router'

/** A week at a time: far enough to find something, short enough to read at a glance. */
const WINDOW_DAYS = 6

/**
 * A patient booking for themselves (P5). The server decides who the patient is from the session,
 * so this form never names one, and the clinic's window decides what is offered: times inside the
 * notice period are already absent from the list (ADR-0022).
 */
export function BookOwnForm({
  doctors,
  today,
  lastBookableDate,
  locale,
  timeZone,
}: {
  doctors: ReadonlyArray<{ id: string; name: string; specialties: string }>
  today: string
  /** The end of the clinic's booking horizon — nothing past it is offered (ADR-0022). */
  lastBookableDate: string
  locale: string
  timeZone: string
}) {
  const t = useTranslations('patient.appointments.new')
  const tCommon = useTranslations('common')
  const router = useRouter()
  const errorMessage = useErrorMessage()
  const fieldId = useId()

  const [doctorId, setDoctorId] = useState(doctors.length === 1 ? (doctors[0]?.id ?? '') : '')
  const [from, setFrom] = useState(today)
  const [startsAt, setStartsAt] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Never ask for — or show — a day beyond the horizon; booking there would only be refused.
  const windowEnd = [shiftDate(from, WINDOW_DAYS), lastBookableDate].sort()[0] ?? from
  const to = windowEnd < from ? from : windowEnd

  async function book() {
    if (!startsAt) return
    setPending(true)
    setError(null)
    try {
      const parsed = BookOwnAppointmentRequest.safeParse({
        doctorId,
        startsAt,
        reason: reason.trim() || null,
      })
      if (!parsed.success) throw new ApiError(400, 'VALIDATION_FAILED', '')
      await apiFetch('/api/v1/me/appointments', { method: 'POST', body: parsed.data })
      router.push('/patient/appointments')
    } catch (caught) {
      setError(errorMessage(caught))
      if (caught instanceof ApiError && caught.status === 409) {
        setStartsAt(null)
        setReloadKey((key) => key + 1)
      }
      setPending(false)
    }
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-5">
        {error ? <Alert tone="danger">{error}</Alert> : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${fieldId}-doctor`}>{t('doctor')}</Label>
            <Select
              id={`${fieldId}-doctor`}
              value={doctorId}
              onChange={(event) => {
                setDoctorId(event.target.value)
                setStartsAt(null)
              }}
            >
              <option value="">{t('chooseDoctor')}</option>
              {doctors.map((doctor) => (
                <option key={doctor.id} value={doctor.id}>
                  {doctor.specialties ? `${doctor.name} — ${doctor.specialties}` : doctor.name}
                </option>
              ))}
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor={`${fieldId}-from`}>{t('fromDate')}</Label>
            <Input
              id={`${fieldId}-from`}
              type="date"
              value={from}
              min={today}
              max={lastBookableDate}
              onChange={(event) => {
                setFrom(event.target.value)
                setStartsAt(null)
              }}
            />
            <p className="text-muted-foreground text-xs">
              {t('horizonHint', { date: formatCalendarDate(lastBookableDate, locale) })}
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">{t('time')}</span>
          <SlotPicker
            doctorId={doctorId || null}
            from={from}
            to={to}
            value={startsAt}
            onChange={setStartsAt}
            locale={locale}
            timeZone={timeZone}
            showDates
            reloadKey={reloadKey}
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor={`${fieldId}-reason`}>
            {t('reason')} <span className="text-muted-foreground">({tCommon('optional')})</span>
          </Label>
          <Input
            id={`${fieldId}-reason`}
            value={reason}
            maxLength={300}
            onChange={(event) => setReason(event.target.value)}
          />
          <p className="text-muted-foreground text-xs">{t('reasonHint')}</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button disabled={pending || !doctorId || !startsAt} onClick={() => void book()}>
            {pending ? <Spinner /> : null}
            {t('submit')}
          </Button>
          <Button
            variant="ghost"
            disabled={pending}
            onClick={() => router.push('/patient/appointments')}
          >
            {tCommon('cancel')}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
