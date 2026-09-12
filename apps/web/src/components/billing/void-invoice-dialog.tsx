'use client'

import { useId, useState } from 'react'
import { useTranslations } from 'next-intl'
import { VoidInvoiceRequest } from '@clinic/contracts'
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

/**
 * Voiding, not deleting (section 8.10). The reason is required and printed on the document,
 * because a number that vanished without a stated cause is what an auditor looks for first.
 */
export function VoidInvoiceDialog({ invoiceId, label }: { invoiceId: string; label: string }) {
  const t = useTranslations('billing.invoice.void')
  const router = useRouter()
  const errorMessage = useErrorMessage()
  const fieldId = useId()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setPending(true)
    setError(null)
    try {
      const parsed = VoidInvoiceRequest.safeParse({ reason })
      if (!parsed.success) throw new ApiError(400, 'VALIDATION_FAILED', '')
      await apiFetch(`/api/v1/billing/invoices/${invoiceId}/void`, {
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
          <DialogDescription>{t('body')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1">
          <Label htmlFor={fieldId}>{t('reason')}</Label>
          <Input
            id={fieldId}
            value={reason}
            maxLength={300}
            required
            autoFocus
            onChange={(event) => setReason(event.target.value)}
          />
        </div>
        {error ? <Alert tone="danger">{error}</Alert> : null}
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
