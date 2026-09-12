'use client'

import { useId, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { BookAppointmentRequest } from '@clinic/contracts'
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
  Select,
  Spinner,
  Textarea,
  type ButtonProps,
} from '@clinic/ui'
import { ApiError, apiFetch } from '@/lib/api/client'
import { useErrorMessage } from '@/lib/i18n/use-error-message'
import { useRouter } from '@/lib/navigation/use-router'
import { PatientPicker, type PickedPatient } from './patient-picker'
import { SlotPicker } from './slot-picker'

/**
 * The front desk booking a patient in (S5). Doctor, day, then one of the times that doctor is
 * actually open — the form cannot express a time the server would refuse.
 *
 * When someone else takes the time first the server answers 409 SLOT_TAKEN (ADR-0013); the
 * dialog stays open, says so, and asks for the open times again, so the next pick is from a
 * list that is seconds old rather than from the one that just lost.
 */
export function BookAppointmentDialog({
  doctors,
  patient: fixedPatient = null,
  date: defaultDate,
  locale,
  timeZone,
  label,
  triggerVariant = 'primary',
  followDate = false,
}: {
  doctors: ReadonlyArray<{ id: string; name: string }>
  /** Set when booking from a patient's own page; the picker is then not shown. */
  patient?: PickedPatient | null
  date: string
  locale: string
  timeZone: string
  label: string
  triggerVariant?: ButtonProps['variant']
  /**
   * On a calendar, move to the day that was booked. Booking for Thursday and being left looking
   * at Tuesday reads as though nothing was saved.
   */
  followDate?: boolean
}) {
  const t = useTranslations('scheduling.book')
  const tCommon = useTranslations('common')
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const errorMessage = useErrorMessage()
  const fieldId = useId()

  const [open, setOpen] = useState(false)
  const [patient, setPatient] = useState<PickedPatient | null>(fixedPatient)
  const [doctorId, setDoctorId] = useState(doctors.length === 1 ? (doctors[0]?.id ?? '') : '')
  const [date, setDate] = useState(defaultDate)
  const [startsAt, setStartsAt] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [internalNote, setInternalNote] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function reset() {
    setPatient(fixedPatient)
    setDoctorId(doctors.length === 1 ? (doctors[0]?.id ?? '') : '')
    setDate(defaultDate)
    setStartsAt(null)
    setReason('')
    setInternalNote('')
    setError(null)
  }

  async function book() {
    if (!patient || !startsAt) return
    setPending(true)
    setError(null)
    try {
      const parsed = BookAppointmentRequest.safeParse({
        patientId: patient.id,
        doctorId,
        startsAt,
        branchId: null,
        reason: reason.trim() || null,
        internalNote: internalNote.trim() || null,
      })
      // Every value came from the server's own lists, so a failure here is a bug, not a typo.
      if (!parsed.success) throw new ApiError(400, 'VALIDATION_FAILED', '')
      await apiFetch('/api/v1/appointments', { method: 'POST', body: parsed.data })
      const booked = date
      setOpen(false)
      reset()
      if (followDate && booked !== defaultDate) {
        const next = new URLSearchParams(params.toString())
        next.set('date', booked)
        router.push(`${pathname}?${next.toString()}`)
      } else {
        router.refresh()
      }
    } catch (caught) {
      setError(errorMessage(caught))
      // The time is gone or was never open: drop the choice and ask for the list again.
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
        // Reset on the way in as well as out: the calendar may have moved to another day
        // since the dialog was last opened, and it should open on the day being looked at.
        reset()
      }}
    >
      <DialogTrigger asChild>
        <Button variant={triggerVariant}>{label}</Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {error ? <Alert tone="danger">{error}</Alert> : null}

          {fixedPatient ? null : <PatientPicker value={patient} onChange={setPatient} />}

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
                    {doctor.name}
                  </option>
                ))}
              </Select>
            </div>
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
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">{t('time')}</span>
            <SlotPicker
              doctorId={doctorId || null}
              from={date}
              to={date}
              value={startsAt}
              onChange={setStartsAt}
              locale={locale}
              timeZone={timeZone}
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
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor={`${fieldId}-note`}>
              {t('internalNote')}{' '}
              <span className="text-muted-foreground">({tCommon('optional')})</span>
            </Label>
            <Textarea
              id={`${fieldId}-note`}
              rows={2}
              maxLength={500}
              value={internalNote}
              onChange={(event) => setInternalNote(event.target.value)}
            />
            <p className="text-muted-foreground text-xs">{t('internalNoteHint')}</p>
          </div>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={pending}>
              {tCommon('cancel')}
            </Button>
          </DialogClose>
          <Button
            disabled={pending || !patient || !doctorId || !startsAt}
            onClick={() => void book()}
          >
            {pending ? <Spinner /> : null}
            {t('submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
