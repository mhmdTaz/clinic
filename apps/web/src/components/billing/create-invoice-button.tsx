'use client'

import { useId, useState } from 'react'
import { useTranslations } from 'next-intl'
import { CreateInvoiceRequest, type InvoiceDetail } from '@clinic/contracts'
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
  Select,
  Spinner,
} from '@clinic/ui'
import { ApiError, apiFetch } from '@/lib/api/client'
import { useErrorMessage } from '@/lib/i18n/use-error-message'
import { useRouter } from '@/lib/navigation/use-router'

export interface BillableVisit {
  id: string
  label: string
}

/**
 * Billing a visit (S7).
 *
 * Choosing a visit and leaving the lines empty seeds the draft from the doctor's consultation
 * fee — the thing that certainly happened — and drops straight into the editor. Guessing the
 * rest of the visit would be worse than a front desk adding two lines.
 */
export function CreateInvoiceButton({
  patientId,
  visits,
  label,
}: {
  patientId: string
  visits: BillableVisit[]
  label: string
}) {
  const t = useTranslations('billing.invoice.create')
  const router = useRouter()
  const errorMessage = useErrorMessage()
  const fieldId = useId()
  const [open, setOpen] = useState(false)
  const [encounterId, setEncounterId] = useState(visits[0]?.id ?? '')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setPending(true)
    setError(null)
    try {
      const parsed = CreateInvoiceRequest.safeParse({
        patientId,
        encounterId: encounterId || null,
        branchId: null,
        lines: [],
        notes: null,
      })
      if (!parsed.success) throw new ApiError(400, 'VALIDATION_FAILED', '')
      const invoice = await apiFetch<InvoiceDetail>('/api/v1/billing/invoices', {
        method: 'POST',
        body: parsed.data,
      })
      setOpen(false)
      router.push(`/staff/billing/${invoice.id}`)
    } catch (caught) {
      setError(errorMessage(caught))
      setPending(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) {
          setEncounterId(visits[0]?.id ?? '')
          setError(null)
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">{label}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('body')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1">
          <label htmlFor={fieldId} className="text-sm font-medium">
            {t('visit')}
          </label>
          <Select
            id={fieldId}
            value={encounterId}
            onChange={(event) => setEncounterId(event.target.value)}
          >
            <option value="">{t('noVisit')}</option>
            {visits.map((visit) => (
              <option key={visit.id} value={visit.id}>
                {visit.label}
              </option>
            ))}
          </Select>
        </div>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <DialogFooter>
          <Button variant="secondary" type="button" onClick={() => setOpen(false)}>
            {t('cancel')}
          </Button>
          <Button type="button" disabled={pending} onClick={() => void submit()}>
            {pending ? <Spinner className="size-4" /> : null}
            {t('confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
