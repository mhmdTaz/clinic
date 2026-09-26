'use client'

import { useId, useState } from 'react'
import { FlaskConical } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { LabOrder } from '@clinic/contracts'
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Label,
  Spinner,
  Textarea,
} from '@clinic/ui'
import { ApiError, apiFetch } from '@/lib/api/client'
import { formatCalendarDate, shiftDate } from '@/lib/format/dates'
import { useErrorMessage, useValidationMessage } from '@/lib/i18n/use-error-message'
import { useRouter } from '@/lib/navigation/use-router'
import { LAB_TONES } from './lab-tones'

/** Planned work a lab can make, as the send dialog offers it. */
export interface LabWork {
  recordId: string
  label: string
}

/**
 * A patient's lab work (Phase 13): what is at which lab and when it is due, what has come back,
 * and what was fitted. Received and fitted are one press; a remake asks for the lab's new date and
 * a cancellation for a reason, since both stay on the record.
 */
export function LabOrders({
  patientId,
  orders,
  work,
  labNames,
  today,
  locale,
  canWrite,
}: {
  patientId: string
  orders: LabOrder[]
  work: LabWork[]
  labNames: string[]
  today: string
  locale: string
  canWrite: boolean
}) {
  const t = useTranslations('dental.lab')
  return (
    <div className="flex flex-col gap-3">
      {canWrite ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-muted-foreground text-sm">
            {work.length > 0 ? t('workReady', { count: work.length }) : t('noWork')}
          </p>
          {work.length > 0 ? (
            <SendDialog patientId={patientId} work={work} labNames={labNames} today={today} />
          ) : null}
        </div>
      ) : null}
      {orders.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('none')}</p>
      ) : (
        <ul className="flex flex-col divide-y rounded-lg border">
          {orders.map((order) => (
            <li
              key={order.id}
              className="flex flex-col gap-2 p-3"
              aria-label={`${order.work.map((w) => w.name).join(', ')} — ${order.labName}`}
              data-lab-status={order.status}
            >
              <div className="flex flex-wrap items-center gap-2">
                <FlaskConical aria-hidden="true" className="text-muted-foreground size-4" />
                <span className="font-medium">
                  {order.work.map((entry) => entry.name).join(', ')}
                  {order.teeth.length > 0 ? ` — ${order.teeth.join(', ')}` : ''}
                </span>
                <Badge tone={order.overdue ? 'danger' : LAB_TONES[order.status]}>
                  {order.overdue ? t('late') : t(`statuses.${order.status}`)}
                </Badge>
              </div>
              <p className="text-muted-foreground text-sm">
                {t('where', {
                  lab: order.labName,
                  sent: formatCalendarDate(order.sentOn, locale),
                  due: formatCalendarDate(order.dueOn, locale),
                })}
              </p>
              {order.notes ? <p className="text-sm">{order.notes}</p> : null}
              {canWrite ? <OrderActions order={order} today={today} /> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function OrderActions({ order, today }: { order: LabOrder; today: string }) {
  const t = useTranslations('dental.lab')
  const router = useRouter()
  const errorMessage = useErrorMessage()
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function move(status: 'RECEIVED' | 'FITTED') {
    setPending(status)
    setError(null)
    try {
      await apiFetch(`/api/v1/lab-orders/${order.id}/status`, {
        method: 'POST',
        body: { status, dueOn: null, note: null },
      })
      router.refresh()
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setPending(null)
    }
  }

  const atLab = order.status === 'SENT' || order.status === 'REMAKE'
  const back = order.status === 'RECEIVED'
  if (!atLab && !back) return null

  return (
    <div className="flex flex-col gap-2">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <div className="flex flex-wrap gap-2">
        {atLab ? (
          <Button size="sm" disabled={pending !== null} onClick={() => void move('RECEIVED')}>
            {pending === 'RECEIVED' ? <Spinner className="size-4" /> : null}
            {t('actions.received')}
          </Button>
        ) : null}
        {back ? (
          <Button size="sm" disabled={pending !== null} onClick={() => void move('FITTED')}>
            {pending === 'FITTED' ? <Spinner className="size-4" /> : null}
            {t('actions.fitted')}
          </Button>
        ) : null}
        {back ? <MoveDialog order={order} status="REMAKE" today={today} /> : null}
        <MoveDialog order={order} status="CANCELLED" today={today} />
      </div>
    </div>
  )
}

function MoveDialog({
  order,
  status,
  today,
}: {
  order: LabOrder
  status: 'REMAKE' | 'CANCELLED'
  today: string
}) {
  const t = useTranslations(`dental.lab.${status === 'REMAKE' ? 'remake' : 'cancel'}`)
  const router = useRouter()
  const errorMessage = useErrorMessage()
  const fieldId = useId()
  const [open, setOpen] = useState(false)
  const [dueOn, setDueOn] = useState(shiftDate(today, 7))
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function submit() {
    setPending(true)
    setError(null)
    try {
      await apiFetch(`/api/v1/lab-orders/${order.id}/status`, {
        method: 'POST',
        body: {
          status,
          dueOn: status === 'REMAKE' ? dueOn : null,
          note: note.trim() || null,
        },
      })
      setOpen(false)
      router.refresh()
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
        setNote('')
        setError(null)
        setDueOn(shiftDate(today, 7))
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant={status === 'CANCELLED' ? 'ghost' : 'outline'}>
          {t('trigger')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('body', { lab: order.labName })}</DialogDescription>
        </DialogHeader>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {status === 'REMAKE' ? (
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${fieldId}-due`}>{t('dueOn')}</Label>
            <Input
              id={`${fieldId}-due`}
              type="date"
              min={today}
              value={dueOn}
              onChange={(event) => setDueOn(event.target.value)}
            />
          </div>
        ) : null}
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${fieldId}-note`}>{t('note')}</Label>
          <Textarea
            id={`${fieldId}-note`}
            rows={3}
            maxLength={300}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="secondary" type="button" onClick={() => setOpen(false)}>
            {t('back')}
          </Button>
          <Button
            type="button"
            variant={status === 'CANCELLED' ? 'danger' : 'primary'}
            disabled={
              pending ||
              (status === 'CANCELLED' && note.trim() === '') ||
              (status === 'REMAKE' && !dueOn)
            }
            onClick={() => void submit()}
          >
            {pending ? <Spinner className="size-4" /> : null}
            {t('confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function SendDialog({
  patientId,
  work,
  labNames,
  today,
}: {
  patientId: string
  work: LabWork[]
  labNames: string[]
  today: string
}) {
  const t = useTranslations('dental.lab.send')
  const router = useRouter()
  const errorMessage = useErrorMessage()
  const validationMessage = useValidationMessage()
  const fieldId = useId()
  const [open, setOpen] = useState(false)
  const [chosen, setChosen] = useState<string[]>([])
  const [labName, setLabName] = useState(labNames[0] ?? '')
  const [dueOn, setDueOn] = useState(shiftDate(today, 7))
  const [notes, setNotes] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [general, setGeneral] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function submit() {
    setPending(true)
    setGeneral(null)
    setErrors({})
    try {
      await apiFetch(`/api/v1/patients/${patientId}/lab-orders`, {
        method: 'POST',
        body: {
          toothRecordIds: chosen,
          labName: labName.trim(),
          sentOn: null,
          dueOn,
          notes: notes.trim() || null,
        },
      })
      setOpen(false)
      router.refresh()
    } catch (caught) {
      if (caught instanceof ApiError && caught.details.length > 0) {
        const placed: Record<string, string> = {}
        for (const detail of caught.details) {
          placed[detail.field.split('.')[0]!] = validationMessage(detail.issue)
        }
        setErrors(placed)
      } else {
        setGeneral(errorMessage(caught))
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
        if (next) {
          setChosen(work.length === 1 ? [work[0]!.recordId] : [])
          setDueOn(shiftDate(today, 7))
          setNotes('')
          setErrors({})
          setGeneral(null)
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">{t('trigger')}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('body')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {general ? <Alert tone="danger">{general}</Alert> : null}
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 text-sm font-medium">{t('work')}</legend>
            {work.map((entry) => (
              <label key={entry.recordId} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={chosen.includes(entry.recordId)}
                  onChange={(event) =>
                    setChosen((current) =>
                      event.target.checked
                        ? [...current, entry.recordId]
                        : current.filter((id) => id !== entry.recordId),
                    )
                  }
                />
                {entry.label}
              </label>
            ))}
            {errors.toothRecordIds ? (
              <p className="text-danger text-sm">{errors.toothRecordIds}</p>
            ) : null}
          </fieldset>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${fieldId}-lab`}>{t('lab')}</Label>
            <Input
              id={`${fieldId}-lab`}
              list={`${fieldId}-labs`}
              maxLength={120}
              value={labName}
              onChange={(event) => setLabName(event.target.value)}
            />
            <datalist id={`${fieldId}-labs`}>
              {labNames.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
            {errors.labName ? <p className="text-danger text-sm">{errors.labName}</p> : null}
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${fieldId}-due`}>{t('dueOn')}</Label>
            <Input
              id={`${fieldId}-due`}
              type="date"
              min={today}
              value={dueOn}
              onChange={(event) => setDueOn(event.target.value)}
            />
            {errors.dueOn ? <p className="text-danger text-sm">{errors.dueOn}</p> : null}
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${fieldId}-notes`}>{t('notes')}</Label>
            <Textarea
              id={`${fieldId}-notes`}
              rows={3}
              maxLength={1000}
              placeholder={t('notesPlaceholder')}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="secondary" type="button" onClick={() => setOpen(false)}>
            {t('cancel')}
          </Button>
          <Button
            type="button"
            disabled={pending || chosen.length === 0 || labName.trim() === '' || !dueOn}
            onClick={() => void submit()}
          >
            {pending ? <Spinner className="size-4" /> : null}
            {t('confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
