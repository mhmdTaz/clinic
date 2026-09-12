'use client'

import { useId, useState } from 'react'
import { useTranslations } from 'next-intl'
import { RegisterWalkInRequest } from '@clinic/contracts'
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
} from '@clinic/ui'
import { ApiError, apiFetch } from '@/lib/api/client'
import { useErrorMessage } from '@/lib/i18n/use-error-message'
import { useRouter } from '@/lib/navigation/use-router'
import { PatientPicker, type PickedPatient } from './patient-picker'

/**
 * Someone at the desk with no appointment (S5, ADR-0023). There is no time to choose: the
 * server takes the doctor's next open slot today and checks them in, which is why this is a
 * different form from booking rather than the booking dialog with the time left blank.
 */
export function WalkInDialog({
  doctors,
  label,
  onDay,
}: {
  doctors: ReadonlyArray<{ id: string; name: string }>
  label: string
  /** The day the calendar is showing; a walk-in always lands on today, so this warns when not. */
  onDay: { date: string; today: string }
}) {
  const t = useTranslations('scheduling.walkIn')
  const tCommon = useTranslations('common')
  const router = useRouter()
  const errorMessage = useErrorMessage()
  const fieldId = useId()

  const [open, setOpen] = useState(false)
  const [patient, setPatient] = useState<PickedPatient | null>(null)
  const [doctorId, setDoctorId] = useState(doctors.length === 1 ? (doctors[0]?.id ?? '') : '')
  const [reason, setReason] = useState('')
  const [internalNote, setInternalNote] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function reset() {
    setPatient(null)
    setDoctorId(doctors.length === 1 ? (doctors[0]?.id ?? '') : '')
    setReason('')
    setInternalNote('')
    setError(null)
  }

  async function register() {
    if (!patient) return
    setPending(true)
    setError(null)
    try {
      const parsed = RegisterWalkInRequest.safeParse({
        patientId: patient.id,
        doctorId,
        branchId: null,
        reason: reason.trim() || null,
        internalNote: internalNote.trim() || null,
      })
      if (!parsed.success) throw new ApiError(400, 'VALIDATION_FAILED', '')
      await apiFetch('/api/v1/appointments/walk-in', { method: 'POST', body: parsed.data })
      setOpen(false)
      reset()
      // A walk-in is always today, so the calendar goes there rather than staying where it was.
      if (onDay.date !== onDay.today) router.push(`?date=${onDay.today}`)
      else router.refresh()
    } catch (caught) {
      setError(errorMessage(caught))
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
        reset()
      }}
    >
      <DialogTrigger asChild>
        <Button variant="secondary">{label}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {error ? <Alert tone="danger">{error}</Alert> : null}

          <PatientPicker value={patient} onChange={setPatient} />

          <div className="flex flex-col gap-2">
            <Label htmlFor={`${fieldId}-doctor`}>{t('doctor')}</Label>
            <Select
              id={`${fieldId}-doctor`}
              value={doctorId}
              onChange={(event) => setDoctorId(event.target.value)}
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
          </div>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={pending}>
              {tCommon('cancel')}
            </Button>
          </DialogClose>
          <Button disabled={pending || !patient || !doctorId} onClick={() => void register()}>
            {pending ? <Spinner /> : null}
            {t('submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
