'use client'

import { useId, useState } from 'react'
import { useTranslations } from 'next-intl'
import { IssueInvoiceRequest, type InvoiceDetail } from '@clinic/contracts'
import { Alert, Button, Spinner } from '@clinic/ui'
import { ApiError, apiFetch } from '@/lib/api/client'
import { useErrorMessage } from '@/lib/i18n/use-error-message'
import { useRouter } from '@/lib/navigation/use-router'

/**
 * Issuing freezes the lines (ADR-0027), so it is a deliberate step rather than a side effect of
 * saving. The due date is left to the clinic's default unless somebody sets one.
 */
export function IssueInvoiceButton({ invoiceId, label }: { invoiceId: string; label: string }) {
  const t = useTranslations('billing.invoice')
  const router = useRouter()
  const errorMessage = useErrorMessage()
  const hintId = useId()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function issue() {
    setPending(true)
    setError(null)
    try {
      const parsed = IssueInvoiceRequest.safeParse({ dueAt: null })
      if (!parsed.success) throw new ApiError(400, 'VALIDATION_FAILED', '')
      await apiFetch<InvoiceDetail>(`/api/v1/billing/invoices/${invoiceId}/issue`, {
        method: 'POST',
        body: parsed.data,
      })
      router.refresh()
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setPending(false)
    }
  }

  return (
    <span className="flex flex-col items-end gap-1">
      <Button
        size="sm"
        type="button"
        disabled={pending}
        aria-describedby={hintId}
        onClick={() => void issue()}
      >
        {pending ? <Spinner className="size-4" /> : null}
        {label}
      </Button>
      {/* What issuing does is not obvious from a one-word button, and it cannot be undone. */}
      <span id={hintId} className="text-muted-foreground max-w-64 text-end text-xs">
        {t('issueHint')}
      </span>
      {error ? <Alert tone="danger">{error}</Alert> : null}
    </span>
  )
}
