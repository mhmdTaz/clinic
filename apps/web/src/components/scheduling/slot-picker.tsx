'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import type { DaySlots } from '@clinic/contracts'
import { Alert, Button, Spinner, cn } from '@clinic/ui'
import { apiFetch } from '@/lib/api/client'
import { formatCalendarDate, formatDayHeading, formatTimeOfDay } from '@/lib/format/dates'
import { useErrorMessage } from '@/lib/i18n/use-error-message'

/**
 * The open times a doctor can be booked into, asked for fresh every time the doctor, the range
 * or the length changes. Slots are computed by the server on each call and never cached here:
 * a time that looks free in a stale list is the one way a double booking reaches the confirm
 * step (section 8.7). The server settles the race regardless (ADR-0013), but the patient should
 * not be told to pick again for a time that was already gone when it was drawn.
 *
 * A range is shown one day at a time (audit F05): a row of the days that have open times, and the
 * times of the day chosen. Every day at once was 92 buttons on a phone, with the confirm button
 * 2,300 pixels below the first of them. A chosen time that is no longer offered when the list is
 * asked again — someone else took it — is cleared rather than left selected.
 */
export function SlotPicker({
  doctorId,
  from,
  to,
  durationMinutes,
  value,
  onChange,
  locale,
  timeZone,
  showDates = false,
  reloadKey = 0,
}: {
  doctorId: string | null
  from: string
  to: string
  durationMinutes?: number
  value: string | null
  onChange: (startsAt: string | null) => void
  locale: string
  timeZone: string
  /** Pick a day, then a time — for a range. A single day is already named by the form. */
  showDates?: boolean
  /** Changing this asks again — after a refused booking, the list must be redrawn. */
  reloadKey?: number
}) {
  const t = useTranslations('scheduling.slots')
  const errorMessage = useErrorMessage()

  const [days, setDays] = useState<DaySlots[] | null>(null)
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState<unknown>(null)
  const [chosenDay, setChosenDay] = useState<string | null>(null)
  const selection = useRef({ value, onChange })
  selection.current = { value, onChange }

  useEffect(() => {
    if (!doctorId) {
      setDays(null)
      return
    }
    // A slower earlier answer must not overwrite a newer one.
    let current = true
    const query = new URLSearchParams({ from, to })
    if (durationMinutes) query.set('durationMinutes', String(durationMinutes))

    setPending(true)
    setFailure(null)
    apiFetch<DaySlots[]>(`/api/v1/doctors/${doctorId}/slots?${query.toString()}`)
      .then((result) => {
        if (!current) return
        setDays(result)
        const chosen = selection.current.value
        const stillOpen = result.some((day) => day.slots.some((slot) => slot.startsAt === chosen))
        if (chosen && !stillOpen) selection.current.onChange(null)
      })
      .catch((caught: unknown) => {
        if (!current) return
        setDays([])
        setFailure(caught)
      })
      .finally(() => {
        if (current) setPending(false)
      })

    return () => {
      current = false
    }
  }, [doctorId, from, to, durationMinutes, reloadKey])

  if (!doctorId) return <p className="text-muted-foreground text-sm">{t('chooseDoctor')}</p>

  if (pending && days === null) {
    return (
      <p className="text-muted-foreground flex items-center gap-2 text-sm">
        <Spinner />
        {t('loading')}
      </p>
    )
  }

  const error = failure === null ? null : errorMessage(failure)
  const withSlots = (days ?? []).filter((day) => day.slots.length > 0)
  // The day on show: the one chosen, else the one holding the chosen time, else the first open.
  const dayOfValue = withSlots.find((day) => day.slots.some((slot) => slot.startsAt === value))
  const shown = showDates
    ? (withSlots.find((day) => day.date === chosenDay) ?? dayOfValue ?? withSlots[0])
    : null
  const visible = showDates ? (shown ? [shown] : []) : withSlots

  return (
    <div
      role="group"
      aria-label={t('groupLabel')}
      aria-busy={pending || undefined}
      className="flex flex-col gap-3"
    >
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {!error && withSlots.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('none')}</p>
      ) : null}

      {showDates && withSlots.length > 0 ? (
        <div role="group" aria-label={t('days')} className="flex gap-2 overflow-x-auto pb-1">
          {withSlots.map((day) => {
            const current = day.date === shown?.date
            return (
              <Button
                key={day.date}
                size="sm"
                variant={current ? 'secondary' : 'outline'}
                aria-pressed={current}
                className={cn(
                  'h-auto shrink-0 flex-col gap-0 py-1.5',
                  current && 'ring-primary ring-2',
                )}
                aria-label={t('dayOption', {
                  date: formatCalendarDate(day.date, locale, 'full'),
                  count: day.slots.length,
                })}
                onClick={() => setChosenDay(day.date)}
              >
                <span className="text-sm font-medium">{formatDayHeading(day.date, locale)}</span>
                <span className="text-muted-foreground text-xs font-normal tabular-nums">
                  {t('count', { count: day.slots.length })}
                </span>
              </Button>
            )
          })}
        </div>
      ) : null}

      {visible.map((day) => (
        <div key={day.date} className="flex flex-col gap-2">
          {showDates ? (
            <p className="text-sm font-medium">{formatCalendarDate(day.date, locale, 'full')}</p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {day.slots.map((slot) => {
              const time = formatTimeOfDay(slot.startsAt, locale, timeZone)
              const selected = slot.startsAt === value
              return (
                <Button
                  key={slot.startsAt}
                  size="sm"
                  variant={selected ? 'primary' : 'outline'}
                  aria-pressed={selected}
                  className="tabular-nums"
                  onClick={() => onChange(selected ? null : slot.startsAt)}
                >
                  {time}
                </Button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
