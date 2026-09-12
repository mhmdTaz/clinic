import { Badge } from '@clinic/ui'
import type { InvoiceStatus, PaymentStatus } from '@clinic/contracts'

const INVOICE_TONES = {
  DRAFT: 'neutral',
  ISSUED: 'info',
  PARTIALLY_PAID: 'warning',
  PAID: 'success',
  VOID: 'neutral',
} as const

/**
 * Colour and words together — never colour alone (section 14.5).
 *
 * Overdue is its own badge rather than a sixth status, because it is a fact about today and the
 * due date rather than a state the invoice transitioned into: an invoice is ISSUED *and* late.
 */
export function InvoiceStatusBadge({
  status,
  label,
  overdue = false,
  overdueLabel,
}: {
  status: InvoiceStatus
  label: string
  overdue?: boolean
  overdueLabel?: string
}) {
  return (
    <span className="flex flex-wrap items-center gap-1.5" data-testid="invoice-status">
      <Badge tone={INVOICE_TONES[status]}>{label}</Badge>
      {overdue && overdueLabel ? <Badge tone="danger">{overdueLabel}</Badge> : null}
    </span>
  )
}

const PAYMENT_TONES = {
  COMPLETED: 'success',
  PARTIALLY_REFUNDED: 'warning',
  REFUNDED: 'neutral',
} as const

export function PaymentStatusBadge({ status, label }: { status: PaymentStatus; label: string }) {
  return (
    <Badge tone={PAYMENT_TONES[status]} data-testid="payment-status">
      {label}
    </Badge>
  )
}
