import type { Metadata } from 'next'
import { getLocale, getTranslations } from 'next-intl/server'
import { accountStatement } from '@clinic/core/billing'
import { getClinicSessionInfo } from '@clinic/core/clinic'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@clinic/ui'
import { DocumentButton } from '@/components/billing/document-button'
import { InvoiceStatusBadge, PaymentStatusBadge } from '@/components/billing/invoice-status-badge'
import { Money } from '@/components/billing/money'
import { EmptyState } from '@/components/portal/empty-state'
import { PageHeader } from '@/components/portal/page-header'
import { requirePortal } from '@/lib/auth/server-session'
import { formatCalendarDate, formatInstant } from '@/lib/format/dates'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('patient.billing')
  return { title: t('title') }
}

/**
 * A patient's statement of account (P8): what they have been billed, what they have paid, and
 * what is left — with every bill printable as the same PDF the clinic would hand them.
 *
 * No patient id is passed: the lists narrow to OWN on the caller's behalf, so this page cannot
 * show somebody else's account even if the URL were tampered with.
 */
export default async function PatientBillingPage() {
  const actor = await requirePortal('patient')
  const [statement, clinic, t, tStatus, tMethod, locale] = await Promise.all([
    accountStatement(actor, undefined),
    getClinicSessionInfo(actor.clinicId),
    getTranslations('patient.billing'),
    getTranslations('billing.statuses'),
    getTranslations('billing.methods'),
    getLocale(),
  ])

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />

      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle>{t('summary')}</CardTitle>
            {/* Only worth saying when there is a voided bill below to explain. */}
            {statement.invoices.some((invoice) => invoice.status === 'VOID') ? (
              <CardDescription>{t('summaryHint')}</CardDescription>
            ) : null}
          </CardHeader>
          <CardContent>
            <dl className="grid gap-3 sm:grid-cols-3">
              <div className="flex flex-col gap-0.5">
                <dt className="text-muted-foreground text-sm">{t('billed')}</dt>
                <dd className="text-lg">
                  <Money
                    amount={statement.invoiced}
                    currency={statement.currency}
                    locale={locale}
                  />
                </dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className="text-muted-foreground text-sm">{t('paid')}</dt>
                <dd className="text-lg">
                  <Money amount={statement.paid} currency={statement.currency} locale={locale} />
                </dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className="text-muted-foreground text-sm">{t('outstanding')}</dt>
                <dd className="text-lg" data-testid="statement-outstanding">
                  <Money
                    amount={statement.outstanding}
                    currency={statement.currency}
                    locale={locale}
                    tone="strong"
                  />
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('invoices')}</CardTitle>
          </CardHeader>
          <CardContent>
            {statement.invoices.length === 0 ? (
              <EmptyState title={t('noInvoices')} body={t('noInvoicesBody')} />
            ) : (
              <ul className="divide-border flex flex-col divide-y">
                {statement.invoices.map((invoice) => (
                  <li key={invoice.id} className="flex flex-col gap-2 py-3 first:pt-0">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className="flex flex-wrap items-center gap-2 font-medium">
                          <span className="tabular-nums">{invoice.number}</span>
                          <InvoiceStatusBadge
                            status={invoice.status}
                            label={tStatus(invoice.status)}
                            overdue={invoice.isOverdue}
                            overdueLabel={tStatus('OVERDUE')}
                          />
                        </span>
                        <span className="text-muted-foreground text-xs">
                          {invoice.issuedAt
                            ? formatInstant(invoice.issuedAt, locale, clinic.timezone)
                            : t('notIssued')}
                          {invoice.dueAt
                            ? ` · ${t('due', {
                                date: formatCalendarDate(invoice.dueAt, locale),
                              })}`
                            : ''}
                        </span>
                      </span>
                      <span className="flex flex-col items-end gap-0.5">
                        <Money
                          amount={invoice.total}
                          currency={invoice.currency}
                          locale={locale}
                          tone="strong"
                        />
                        <span className="text-muted-foreground text-xs">
                          {t('balance')}{' '}
                          <Money
                            amount={invoice.balanceDue}
                            currency={invoice.currency}
                            locale={locale}
                          />
                        </span>
                      </span>
                    </div>
                    {invoice.status === 'VOID' ? null : (
                      <div className="flex justify-end">
                        <DocumentButton
                          href={`/api/v1/billing/invoices/${invoice.id}/pdf`}
                          label={t('print')}
                        />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('payments')}</CardTitle>
          </CardHeader>
          <CardContent>
            {statement.payments.length === 0 ? (
              <EmptyState title={t('noPayments')} />
            ) : (
              <ul className="divide-border flex flex-col divide-y">
                {statement.payments.map((payment) => (
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
                        </span>
                      </span>
                      <Money
                        amount={payment.amount}
                        currency={payment.currency}
                        locale={locale}
                        tone="strong"
                      />
                    </div>
                    <div className="flex justify-end">
                      <DocumentButton
                        href={`/api/v1/billing/payments/${payment.id}/receipt`}
                        label={t('receipt')}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  )
}
