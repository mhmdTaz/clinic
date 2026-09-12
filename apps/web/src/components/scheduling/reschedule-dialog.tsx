'use client'

import { useId, useState } from 'react'
import { useTranslations } from 'next-intl'
import { RescheduleAppointmentRequest } from '@clinic/contracts'
import {
  Alert,
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Label,
  Spinner,
} from '@clinic/ui'
import { ApiError, apiFetch } from '@/lib/api/client'
import { useErrorMessage } from '@/lib/i18n/use-error-message'
import { useRouter } from '@/lib/navigation/use-router'
import { SlotPicker } from './slot-picker'

/**
 * Moving an appointment to another of the doctor's open times. The appointment keeps its number
 * and its history; only the time changes, and the reservation moves with it (ADR-0013). The
 * doctor is not changed here: a different doctor is a different appointment.
 */
export function RescheduleDialog({
  appointmentId,
  doctorId,
  date: currentDate,
  durationMinutes,
  locale,
  timeZone,
  label,
}: {
  appointmentId: string
  doctorId: string
  /** The day it sits on now, so the picker opens where the appointment already is. */
  date: string
  durationMinutes: number
  locale: string
  timeZone: string
  label: string
}) {
  const t = useTranslations('scheduling.reschedule')
  const tCommon = useTranslations('common')
  const router = useRouter()
  const errorMessage = useErrorMessage()
  const fieldId = useId()

  const [open, setOpen] = useState(false)
  const [date, setDate] = useState(currentDate)
  const [startsAt, setStartsAt] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function reset() {
    setDate(currentDate)
    setStartsAt(null)
    setReason('')
    setError(null)
  }

  async function move() {
    if (!startsAt) return
    setPending(true)
    setError(null)
    try {
      const parsed = RescheduleAppointmentRequest.safeParse({
        startsAt,
        durationMinutes,
        reason: reason.trim() || null,
      })
      if (!parsed.success) throw new ApiError(400, 'VALIDATION_FAILED', '')
      await apiFetch(`/api/v1/appointments/${appointmentId}/reschedule`, {
        method: 'POST',
        body: parsed.data,
      })
      setOpen(false)
      reset()
      router.refresh()
    } catch (caught) {
      setError(errorMessage(caught))
      if (caught instanceof ApiError && caught.status === 409) {
        setStartsAt(null)
        setReloadKey((key) => key + 1)
      }
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return
        setOpen(next)
        if (!next) reset()
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

        {error ? <Alert tone="danger">{error}</Alert> : null}

        <div className="flex flex-col gap-2">
          <Label htmlFor={`${fieldId}-date`}>{t('date')}</Label>
          <Input
            id={`${fieldId}-date`}
            type="date"
            value={date}
            onChange={(event) => {
              setDate(event.target.value)
              setStartsAt(null)
            }}
          />
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">{t('time')}</span>
          <SlotPicker
            doctorId={doctorId}
            from={date}
            to={date}
            durationMinutes={durationMinutes}
            value={startsAt}
            onChange={setStartsAt}
            locale={locale}
            timeZone={timeZone}
            reloadKey={reloadKey}
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor={`${fieldId}-reason`}>{tCommon('reasonOptional')}</Label>
          <Input
            id={`${fieldId}-reason`}
            value={reason}
            maxLength={300}
            onChange={(event) => setReason(event.target.value)}
          />
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={pending}>
              {tCommon('cancel')}
            </Button>
          </DialogClose>
          <Button disabled={pending || !startsAt} onClick={() => void move()}>
            {pending ? <Spinner /> : null}
            {t('submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
