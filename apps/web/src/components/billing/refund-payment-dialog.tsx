'use client'

import { useId, useState } from 'react'
import { useTranslations } from 'next-intl'
import { RefundPaymentRequest, type Payment } from '@clinic/contracts'
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
  Spinner,
} from '@clinic/ui'
import { ApiError, apiFetch } from '@/lib/api/client'
import { useErrorMessage } from '@/lib/i18n/use-error-message'
import { useRouter } from '@/lib/navigation/use-router'
import { Money } from './money'

/**
 * Giving money back (S8). The amount defaults to what is still refundable, and the server
 * decides which invoices it comes off — the last one the payment settled, first.
 */
export function RefundPaymentDialog({
  payment,
  refundable,
  locale,
  label,
}: {
  payment: Payment
  refundable: string
  locale: string
  label: string
}) {
  const t = useTranslations('billing.refund')
  const router = useRouter()
  const errorMessage = useErrorMessage()
  const fieldId = useId()
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState(refundable)
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setPending(true)
    setError(null)
    try {
      const parsed = RefundPaymentRequest.safeParse({ amount, reason })
      if (!parsed.success) throw new ApiError(400, 'VALIDATION_FAILED', '')
      await apiFetch(`/api/v1/billing/payments/${payment.id}/refund`, {
        method: 'POST',
        body: parsed.data,
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
        setOpen(next)
        if (next) {
          setAmount(refundable)
          setReason('')
          setError(null)
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>
            {t('refundable')}{' '}
            <Money amount={refundable} currency={payment.currency} locale={locale} tone="strong" />{' '}
            · {payment.number}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${fieldId}-amount`}>{t('amount')}</Label>
            <Input
              id={`${fieldId}-amount`}
              value={amount}
              inputMode="decimal"
              autoFocus
              onChange={(event) => setAmount(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${fieldId}-reason`}>{t('reason')}</Label>
            <Input
              id={`${fieldId}-reason`}
              value={reason}
              maxLength={300}
              required
              onChange={(event) => setReason(event.target.value)}
            />
          </div>
          {error ? <Alert tone="danger">{error}</Alert> : null}
        </div>
        <DialogFooter>
          <Button variant="secondary" type="button" onClick={() => setOpen(false)}>
            {t('cancel')}
          </Button>
          <Button
            variant="danger"
            type="button"
            disabled={pending || reason.trim() === ''}
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
