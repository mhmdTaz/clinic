'use client'

import { useId, useState } from 'react'
import { X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { IssuePrescriptionRequest, issueCode, issuePath } from '@clinic/contracts'
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
import { useErrorMessage, useValidationMessage } from '@/lib/i18n/use-error-message'
import { useRouter } from '@/lib/navigation/use-router'

interface ItemRow {
  key: string
  drugName: string
  strength: string
  form: string
  dosage: string
  frequency: string
  durationDays: string
  quantity: string
  instructions: string
}

let sequence = 0
const emptyItem = (): ItemRow => ({
  key: `item-${(sequence += 1)}`,
  drugName: '',
  strength: '',
  form: '',
  dosage: '',
  frequency: '',
  durationDays: '',
  quantity: '',
  instructions: '',
})

/**
 * The prescription builder (D8).
 *
 * A prescription is issued whole and never edited afterwards: what a patient was told to take on
 * a given day is a fact about that day. A mistake is corrected by issuing a new one, which is
 * also how a pharmacy expects to be told.
 */
export function PrescriptionBuilder({
  encounterId,
  label,
}: {
  encounterId: string
  label: string
}) {
  const t = useTranslations('clinical.prescriptions')
  const tCommon = useTranslations('common')
  const router = useRouter()
  const errorMessage = useErrorMessage()
  const validationMessage = useValidationMessage()
  const fieldId = useId()

  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<ItemRow[]>([emptyItem()])
  const [validUntil, setValidUntil] = useState('')
  const [notes, setNotes] = useState('')
  const [errors, setErrors] = useState<Record<number, string>>({})
  const [general, setGeneral] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  function reset() {
    setItems([emptyItem()])
    setValidUntil('')
    setNotes('')
    setErrors({})
    setGeneral(null)
  }

  function change(index: number, patch: Partial<ItemRow>) {
    setItems((current) => current.map((item, at) => (at === index ? { ...item, ...patch } : item)))
    setErrors({})
  }

  function report(details: ReadonlyArray<{ field: string; issue: string }>): boolean {
    const placed: Record<number, string> = {}
    let other = false
    for (const detail of details) {
      const match = /^items\.(\d+)\./.exec(detail.field)
      if (match) placed[Number(match[1])] = validationMessage(detail.issue)
      else other = true
    }
    setErrors(placed)
    return other
  }

  async function issue() {
    setGeneral(null)
    setErrors({})

    const parsed = IssuePrescriptionRequest.safeParse({
      items: items.map((item) => ({
        drugName: item.drugName,
        strength: item.strength || null,
        form: item.form || null,
        dosage: item.dosage,
        frequency: item.frequency,
        durationDays: item.durationDays || null,
        quantity: item.quantity || null,
        instructions: item.instructions || null,
        isRefillable: false,
      })),
      validUntil: validUntil || null,
      notes: notes || null,
    })
    if (!parsed.success) {
      const other = report(
        parsed.error.issues.map((issue) => ({ field: issuePath(issue), issue: issueCode(issue) })),
      )
      if (other) setGeneral(errorMessage(new ApiError(400, 'VALIDATION_FAILED', '')))
      return
    }

    setPending(true)
    try {
      await apiFetch(`/api/v1/encounters/${encounterId}/prescriptions`, {
        method: 'POST',
        body: parsed.data,
      })
      setOpen(false)
      reset()
      router.refresh()
    } catch (caught) {
      const other = caught instanceof ApiError ? report(caught.details) : true
      if (other) setGeneral(errorMessage(caught))
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
        <Button variant="outline" size="sm">
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('newTitle')}</DialogTitle>
          <DialogDescription>{t('newDescription')}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {general ? <Alert tone="danger">{general}</Alert> : null}

          {items.map((item, index) => (
            <fieldset
              key={item.key}
              className="border-border flex flex-col gap-2 rounded-[var(--radius-control)] border p-3"
            >
              <legend className="px-1 text-xs font-medium">
                {t('item', { number: index + 1 })}
              </legend>

              <div className="grid gap-2 sm:grid-cols-3">
                <Input
                  value={item.drugName}
                  maxLength={200}
                  aria-label={t('drugName')}
                  placeholder={t('drugName')}
                  aria-invalid={Boolean(errors[index]) || undefined}
                  onChange={(event) => change(index, { drugName: event.target.value })}
                />
                <Input
                  value={item.strength}
                  maxLength={60}
                  aria-label={t('strength')}
                  placeholder={t('strength')}
                  onChange={(event) => change(index, { strength: event.target.value })}
                />
                <Input
                  value={item.form}
                  maxLength={60}
                  aria-label={t('form')}
                  placeholder={t('form')}
                  onChange={(event) => change(index, { form: event.target.value })}
                />
              </div>

              <div className="grid gap-2 sm:grid-cols-4">
                <Input
                  value={item.dosage}
                  maxLength={120}
                  aria-label={t('dosage')}
                  placeholder={t('dosage')}
                  onChange={(event) => change(index, { dosage: event.target.value })}
                />
                <Input
                  value={item.frequency}
                  maxLength={120}
                  aria-label={t('frequency')}
                  placeholder={t('frequency')}
                  onChange={(event) => change(index, { frequency: event.target.value })}
                />
                <Input
                  value={item.durationDays}
                  inputMode="numeric"
                  aria-label={t('durationDays')}
                  placeholder={t('durationDays')}
                  onChange={(event) => change(index, { durationDays: event.target.value })}
                />
                <Input
                  value={item.quantity}
                  inputMode="numeric"
                  aria-label={t('quantity')}
                  placeholder={t('quantity')}
                  onChange={(event) => change(index, { quantity: event.target.value })}
                />
              </div>

              <div className="flex items-center gap-2">
                <Input
                  value={item.instructions}
                  maxLength={300}
                  aria-label={t('instructions')}
                  placeholder={t('instructions')}
                  onChange={(event) => change(index, { instructions: event.target.value })}
                />
                {items.length > 1 ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={t('removeItem', { number: index + 1 })}
                    onClick={() => setItems((current) => current.filter((_, at) => at !== index))}
                  >
                    <X className="size-4" aria-hidden="true" />
                  </Button>
                ) : null}
              </div>

              {errors[index] ? (
                <p className="text-danger text-xs font-medium">{errors[index]}</p>
              ) : null}
            </fieldset>
          ))}

          <Button
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() => setItems((current) => [...current, emptyItem()])}
          >
            {t('addItem')}
          </Button>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor={`${fieldId}-valid`}>
                {t('validUntil')}{' '}
                <span className="text-muted-foreground">({tCommon('optional')})</span>
              </Label>
              <Input
                id={`${fieldId}-valid`}
                type="date"
                value={validUntil}
                onChange={(event) => setValidUntil(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`${fieldId}-notes`}>
                {t('notes')} <span className="text-muted-foreground">({tCommon('optional')})</span>
              </Label>
              <Input
                id={`${fieldId}-notes`}
                value={notes}
                maxLength={500}
                onChange={(event) => setNotes(event.target.value)}
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={pending}>
              {tCommon('cancel')}
            </Button>
          </DialogClose>
          <Button disabled={pending} onClick={() => void issue()}>
            {pending ? <Spinner /> : null}
            {t('issue')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
