'use client'

import { useId, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { PAYMENT_METHODS } from '@clinic/config'
import { RecordPaymentRequest, type InvoiceSummary, type Payment } from '@clinic/contracts'
import {
  Alert,
  Button,
  Dialog,
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
} from '@clinic/ui'
import { ApiError, apiFetch } from '@/lib/api/client'
import { useErrorMessage } from '@/lib/i18n/use-error-message'
import { useRouter } from '@/lib/navigation/use-router'
import { Money } from './money'

/**
 * Taking money at the desk (S8).
 *
 * The idempotency key is minted **once, when the dialog opens**, and reused for every attempt
 * with these figures. That is what makes a double-click — or a retry after a timeout the request
 * actually survived — settle the invoice once rather than twice. The button being disabled while
 * a request is in flight is not the guard; it is a courtesy on top of one. The guard is the key,
 * and a unique index behind it (ADR-0028).
 *
 * The key is re-minted when the amount changes, because a second, genuinely different payment of
 * the same invoice is a second payment and must not be swallowed as a repeat of the first.
 */
export function RecordPaymentDialog({
  invoice,
  locale,
  label,
}: {
  invoice: InvoiceSummary
  locale: string
  label: string
}) {
  const t = useTranslations('billing.payment')
  const tMethod = useTranslations('billing.methods')
  const router = useRouter()
  const errorMessage = useErrorMessage()
  const fieldId = useId()

  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState(invoice.balanceDue)
  const [method, setMethod] = useState<string>('CASH')
  const [reference, setReference] = useState('')
  const [note, setNote] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** One attempt, one key. Keyed by the amount so a different payment is a different attempt. */
  const attempt = useRef<{ amount: string; key: string }>({
    amount: invoice.balanceDue,
    key: crypto.randomUUID(),
  })
  const keyFor = (value: string) => {
    if (attempt.current.amount !== value) {
      attempt.current = { amount: value, key: crypto.randomUUID() }
    }
    return attempt.current.key
  }

  function reset(next: boolean) {
    setOpen(next)
    if (!next) return
    setAmount(invoice.balanceDue)
    setMethod('CASH')
    setReference('')
    setNote('')
    setError(null)
    attempt.current = { amount: invoice.balanceDue, key: crypto.randomUUID() }
  }

  async function record() {
    setPending(true)
    setError(null)
    try {
      const parsed = RecordPaymentRequest.safeParse({
        patientId: invoice.patient.id,
        amount,
        method,
        reference: reference.trim() === '' ? null : reference,
        note: note.trim() === '' ? null : note,
        allocations: [{ invoiceId: invoice.id, amount }],
        idempotencyKey: keyFor(amount),
      })
      if (!parsed.success) throw new ApiError(400, 'VALIDATION_FAILED', '')
      await apiFetch<Payment>('/api/v1/billing/payments', { method: 'POST', body: parsed.data })
      setOpen(false)
      router.refresh()
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogTrigger asChild>
        <Button size="sm">{label}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>
            {t('owing')}{' '}
            <Money
              amount={invoice.balanceDue}
              currency={invoice.currency}
              locale={locale}
              tone="strong"
            />{' '}
            · {invoice.number}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${fieldId}-amount`}>{t('fields.amount')}</Label>
            <Input
              id={`${fieldId}-amount`}
              value={amount}
              inputMode="decimal"
              autoFocus
              onChange={(event) => setAmount(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${fieldId}-method`}>{t('fields.method')}</Label>
            <Select
              id={`${fieldId}-method`}
              value={method}
              onChange={(event) => setMethod(event.target.value)}
            >
              {PAYMENT_METHODS.map((option) => (
                <option key={option} value={option}>
                  {tMethod(option)}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${fieldId}-reference`}>{t('fields.reference')}</Label>
            <Input
              id={`${fieldId}-reference`}
              value={reference}
              maxLength={120}
              onChange={(event) => setReference(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${fieldId}-note`}>{t('fields.note')}</Label>
            <Input
              id={`${fieldId}-note`}
              value={note}
              maxLength={300}
              onChange={(event) => setNote(event.target.value)}
            />
          </div>
          {error ? <Alert tone="danger">{error}</Alert> : null}
        </div>

        <DialogFooter>
          <Button variant="secondary" type="button" onClick={() => reset(false)}>
            {t('actions.cancel')}
          </Button>
          <Button type="button" disabled={pending} onClick={() => void record()}>
            {pending ? <Spinner className="size-4" /> : null}
            {t('actions.take')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
