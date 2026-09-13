import type { Metadata } from 'next'
import Link from 'next/link'
import { getLocale, getTranslations } from 'next-intl/server'
import { subtractAmounts } from '@clinic/contracts'
import { holds } from '@clinic/core/access'
import { getInvoice, listPayments, listServices } from '@clinic/core/billing'
import { getClinicSessionInfo } from '@clinic/core/clinic'
import { Alert, Card, CardContent, CardHeader, CardTitle } from '@clinic/ui'
import { DocumentButton } from '@/components/billing/document-button'
import { InvoiceLinesEditor } from '@/components/billing/invoice-lines-editor'
import { InvoiceStatusBadge, PaymentStatusBadge } from '@/components/billing/invoice-status-badge'
import { IssueInvoiceButton } from '@/components/billing/issue-invoice-button'
import { Money } from '@/components/billing/money'
import { RecordPaymentDialog } from '@/components/billing/record-payment-dialog'
import { RefundPaymentDialog } from '@/components/billing/refund-payment-dialog'
import { VoidInvoiceDialog } from '@/components/billing/void-invoice-dialog'
import { EmptyState } from '@/components/portal/empty-state'
import { PageHeader } from '@/components/portal/page-header'
import { requirePortal } from '@/lib/auth/server-session'
import { collectPages } from '@/lib/server/pages'
import { formatCalendarDate, formatInstant } from '@/lib/format/dates'
import { orNotFound, type RouteParams } from '@/lib/server/page-helpers'

export async function generateMetadata({
  params,
}: {
  params: RouteParams<'invoiceId'>
}): Promise<Metadata> {
  const actor = await requirePortal('staff')
  const invoice = await getInvoice(actor, (await params).invoiceId).catch(() => null)
  const t = await getTranslations('staff.billing')
  return { title: invoice ? invoice.number : t('title') }
}

/**
 * One bill, from draft to settled (S7, S8).
 *
 * A draft shows the line editor; anything issued shows the lines as they were frozen, because
 * the copy in the patient's hand is the document. Payments and refunds live on the same page as
 * the balance they move, so the person taking money never has to hold two screens in their head.
 */
export default async function InvoicePage({ params }: { params: RouteParams<'invoiceId'> }) {
  const actor = await requirePortal('staff')
  const { invoiceId } = await params

  const invoice = await orNotFound(getInvoice(actor, invoiceId))
  const [clinic, payments, services, t, tStatus, tPayment, tMethod, locale] = await Promise.all([
    getClinicSessionInfo(actor.clinicId),
    holds(actor, 'payment:read')
      ? collectPages((page) => listPayments(actor, { invoiceId, ...page }), 500).then(
          (result) => result.items,
        )
      : [],
    invoice.status === 'DRAFT' && holds(actor, 'service:read')
      ? listServices(actor, { status: 'active' })
      : [],
    getTranslations('billing.invoice'),
    getTranslations('billing.statuses'),
    getTranslations('billing.payment'),
    getTranslations('billing.methods'),
    getLocale(),
  ])

  const isDraft = invoice.status === 'DRAFT'
  const payable = invoice.status === 'ISSUED' || invoice.status === 'PARTIALLY_PAID'
  // Every figure on the page carries its currency; a bare "65.00" beside a formatted "$72.15"
  // reads as two different kinds of number.
  const money = new Intl.NumberFormat(locale, { style: 'currency', currency: invoice.currency })

  return (
    <>
      <PageHeader
        title={invoice.number}
        subtitle={`${invoice.patient.name} · ${invoice.patient.medicalRecordNo}`}
        badges={
          <InvoiceStatusBadge
            status={invoice.status}
            label={tStatus(invoice.status)}
            overdue={invoice.isOverdue}
            overdueLabel={tStatus('OVERDUE')}
          />
        }
        back={{ href: '/staff/billing', label: t('back') }}
        actions={
          <span className="flex flex-wrap items-center gap-2">
            {isDraft && holds(actor, 'invoice:issue') ? (
              <IssueInvoiceButton invoiceId={invoice.id} label={t('actions.issue')} />
            ) : null}
            {payable && holds(actor, 'payment:record') ? (
              <RecordPaymentDialog
                invoice={invoice}
                locale={locale}
                label={tPayment('actions.record')}
              />
            ) : null}
            {invoice.status !== 'VOID' ? (
              <DocumentButton
                href={`/api/v1/billing/invoices/${invoice.id}/pdf`}
                label={t('actions.print')}
              />
            ) : null}
            {(isDraft || invoice.status === 'ISSUED') && holds(actor, 'invoice:void') ? (
              <VoidInvoiceDialog invoiceId={invoice.id} label={t('actions.void')} />
            ) : null}
          </span>
        }
      />

      {invoice.status === 'VOID' ? (
        <Alert tone="warning" className="mb-4">
          {t('voided', {
            date: invoice.voidedAt ? formatInstant(invoice.voidedAt, locale, clinic.timezone) : '',
            reason: invoice.voidReason ?? '',
          })}
        </Alert>
      ) : null}

      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle>{t('lines')}</CardTitle>
          </CardHeader>
          <CardContent>
            {isDraft && holds(actor, 'invoice:create') ? (
              <InvoiceLinesEditor invoice={invoice} services={services} locale={locale} />
            ) : (
              <div className="flex flex-col gap-4">
                <ul className="divide-border flex flex-col divide-y">
                  {invoice.lines.map((line) => (
                    <li
                      key={line.id}
                      className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0"
                    >
                      <span className="flex min-w-0 flex-col">
                        <span className="font-medium break-words">{line.description}</span>
                        <span className="text-muted-foreground text-xs tabular-nums">
                          {t('lineDetail', {
                            quantity: line.quantity,
                            unitPrice: money.format(Number(line.unitPrice)),
                            tax: line.taxRatePercent,
                          })}
                        </span>
                      </span>
                      <Money
                        amount={line.lineTotal}
                        currency={invoice.currency}
                        locale={locale}
                        tone="strong"
                      />
                    </li>
                  ))}
                </ul>
                <dl className="border-border flex flex-col gap-1 border-t pt-3 text-sm">
                  <Row label={t('totals.subtotal')}>
                    <Money amount={invoice.subtotal} currency={invoice.currency} locale={locale} />
                  </Row>
                  <Row label={t('totals.discount')}>
                    <Money
                      amount={invoice.discountTotal}
                      currency={invoice.currency}
                      locale={locale}
                    />
                  </Row>
                  <Row label={t('totals.tax')}>
                    <Money amount={invoice.taxTotal} currency={invoice.currency} locale={locale} />
                  </Row>
                  <Row label={t('totals.total')}>
                    <Money
                      amount={invoice.total}
                      currency={invoice.currency}
                      locale={locale}
                      tone="strong"
                    />
                  </Row>
                  <Row label={t('totals.paid')}>
                    <Money
                      amount={invoice.amountPaid}
                      currency={invoice.currency}
                      locale={locale}
                    />
                  </Row>
                  <Row label={t('totals.balance')} testId="invoice-balance">
                    <Money
                      amount={invoice.balanceDue}
                      currency={invoice.currency}
                      locale={locale}
                      tone="strong"
                    />
                  </Row>
                </dl>
                {invoice.dueAt ? (
                  <p className="text-muted-foreground text-sm">
                    {t('dueOn', { date: formatCalendarDate(invoice.dueAt, locale) })}
                  </p>
                ) : null}
                {invoice.notes ? <p className="text-sm">{invoice.notes}</p> : null}
                {invoice.encounterId ? (
                  <Link
                    href={`/staff/patients/${invoice.patient.id}`}
                    className="text-primary text-sm underline underline-offset-4"
                  >
                    {t('fromVisit')}
                  </Link>
                ) : null}
              </div>
            )}
          </CardContent>
        </Card>

        {holds(actor, 'payment:read') ? (
          <Card>
            <CardHeader>
              <CardTitle>{tPayment('title')}</CardTitle>
            </CardHeader>
            <CardContent>
              {payments.length === 0 ? (
                <EmptyState title={tPayment('none')} />
              ) : (
                <ul className="divide-border flex flex-col divide-y">
                  {payments.map((payment) => {
                    const refundable = subtractAmounts(
                      payment.currency,
                      payment.amount,
                      payment.refundedAmount,
                    )
                    return (
                      <li key={payment.id} className="flex flex-col gap-2 py-3 first:pt-0">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <span className="flex min-w-0 flex-col gap-0.5">
                            <span className="flex flex-wrap items-center gap-2 font-medium">
                              <span className="tabular-nums">{payment.number}</span>
                              <PaymentStatusBadge
                                status={payment.status}
                                label={tStatus(payment.status)}
                              />
                            </span>
                            <span className="text-muted-foreground text-xs">
                              {formatInstant(payment.receivedAt, locale, clinic.timezone)} ·{' '}
                              {tMethod(payment.method)}
                              {payment.reference ? ` · ${payment.reference}` : ''}
                            </span>
                          </span>
                          <Money
                            amount={payment.amount}
                            currency={payment.currency}
                            locale={locale}
                            tone="strong"
                          />
                        </div>
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          <DocumentButton
                            href={`/api/v1/billing/payments/${payment.id}/receipt`}
                            label={tPayment('actions.receipt')}
                          />
                          {holds(actor, 'payment:refund') && payment.status !== 'REFUNDED' ? (
                            <RefundPaymentDialog
                              payment={payment}
                              refundable={refundable}
                              locale={locale}
                              label={tPayment('actions.refund')}
                            />
                          ) : null}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        ) : null}
      </div>
    </>
  )
}

function Row({
  label,
  children,
  testId,
}: {
  label: string
  children: React.ReactNode
  testId?: string
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd data-testid={testId}>{children}</dd>
    </div>
  )
}
