import type { ReactNode } from 'react'
import Link from 'next/link'
import { getLocale, getTranslations } from 'next-intl/server'
import type { InvoiceSummary } from '@clinic/contracts'
import { Card, CardContent, CardHeader, CardTitle } from '@clinic/ui'
import { EmptyState } from '@/components/portal/empty-state'
import { formatCalendarDate } from '@/lib/format/dates'
import { InvoiceStatusBadge } from './invoice-status-badge'
import { Money } from './money'

/** A patient's bills, wherever their record is open (S7). */
export async function PatientInvoicesCard({
  invoices,
  action,
}: {
  invoices: InvoiceSummary[]
  /** The "bill this visit" dialog, for someone who may draw one up. */
  action?: ReactNode
}) {
  const [t, tStatus, locale] = await Promise.all([
    getTranslations('billing.invoice'),
    getTranslations('billing.statuses'),
    getLocale(),
  ])

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <CardTitle>{t('cardTitle')}</CardTitle>
        {/* On an empty card the action belongs to the empty state, which explains it. Rendering
            it in both places puts two identical primary buttons on the same screen. */}
        {invoices.length > 0 ? action : null}
      </CardHeader>
      <CardContent>
        {invoices.length === 0 ? (
          <EmptyState title={t('none')} action={action} />
        ) : (
          <ul className="divide-border flex flex-col divide-y">
            {invoices.map((invoice) => (
              <li key={invoice.id}>
                <Link
                  href={`/staff/billing/${invoice.id}`}
                  className="hover:bg-muted -mx-2 flex flex-wrap items-start justify-between gap-3 rounded-md px-2 py-3"
                >
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
                    {invoice.dueAt ? (
                      <span className="text-muted-foreground text-xs">
                        {t('dueOn', { date: formatCalendarDate(invoice.dueAt, locale) })}
                      </span>
                    ) : null}
                  </span>
                  <span className="flex flex-col items-end gap-0.5">
                    <Money
                      amount={invoice.total}
                      currency={invoice.currency}
                      locale={locale}
                      tone="strong"
                    />
                    <span className="text-muted-foreground text-xs">
                      {t('totals.balance')}{' '}
                      <Money
                        amount={invoice.balanceDue}
                        currency={invoice.currency}
                        locale={locale}
                      />
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
