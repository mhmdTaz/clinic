import type { Metadata } from 'next'
import Link from 'next/link'
import { getLocale, getTranslations } from 'next-intl/server'
import type { InvoiceListQuery, InvoiceStatus } from '@clinic/contracts'
import { INVOICE_STATUSES } from '@clinic/config'
import { holds } from '@clinic/core/access'
import { listInvoices } from '@clinic/core/billing'
import { buttonVariants } from '@clinic/ui'
import { InvoiceStatusBadge } from '@/components/billing/invoice-status-badge'
import { Money } from '@/components/billing/money'
import { DataTable } from '@/components/data-table/data-table'
import { PageHeader } from '@/components/portal/page-header'
import { requirePortal } from '@/lib/auth/server-session'
import { formatCalendarDate } from '@/lib/format/dates'
import { param, type SearchParams } from '@/lib/server/page-helpers'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('staff.billing')
  return { title: t('title') }
}

const isStatus = (value: string | undefined): value is InvoiceStatus =>
  value !== undefined && (INVOICE_STATUSES as readonly string[]).includes(value)

/**
 * The front desk's ledger (S7). It opens on what is still owed, because that is the list anybody
 * comes here to work through; "all" is one filter away.
 */
export default async function StaffBillingPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requirePortal('staff')
  const values = await searchParams
  const status = param(values, 'status')
  const view = status ?? 'outstanding'

  const query: Partial<InvoiceListQuery> = {
    outstanding: view === 'outstanding' ? true : undefined,
    status: isStatus(status) ? status : undefined,
    cursor: param(values, 'cursor'),
    limit: 50,
  }

  const [page, t, tStatus, locale] = await Promise.all([
    listInvoices(actor, query),
    getTranslations('staff.billing'),
    getTranslations('billing.statuses'),
    getLocale(),
  ])

  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          holds(actor, 'payment:read') ? (
            <Link href="/staff/billing/day" className={buttonVariants({ variant: 'outline' })}>
              {t('endOfDay')}
            </Link>
          ) : null
        }
      />
      <DataTable
        label={t('title')}
        columns={[
          { id: 'invoice', header: t('columns.invoice'), priority: 1 },
          { id: 'status', header: t('columns.status'), priority: 2 },
          { id: 'due', header: t('columns.due'), priority: 3 },
          { id: 'total', header: t('columns.total'), priority: 2, align: 'end' },
          { id: 'balance', header: t('columns.balance'), priority: 1, align: 'end' },
        ]}
        filters={[
          {
            param: 'status',
            label: t('columns.status'),
            value: view,
            options: [
              { value: 'outstanding', label: t('filters.outstanding') },
              ...INVOICE_STATUSES.map((option) => ({
                value: option,
                label: tStatus(option),
              })),
            ],
          },
        ]}
        nextCursor={page.nextCursor}
        rows={page.items.map((invoice) => ({
          id: invoice.id,
          href: `/staff/billing/${invoice.id}`,
          cells: {
            invoice: (
              <span className="flex min-w-0 flex-col">
                <span className="font-medium break-words">{invoice.patient.name}</span>
                <span className="text-muted-foreground text-xs font-normal tabular-nums">
                  {invoice.number} · {invoice.patient.medicalRecordNo}
                </span>
              </span>
            ),
            status: (
              <InvoiceStatusBadge
                status={invoice.status}
                label={tStatus(invoice.status)}
                overdue={invoice.isOverdue}
                overdueLabel={tStatus('OVERDUE')}
              />
            ),
            due: invoice.dueAt ? (
              <span className="tabular-nums">{formatCalendarDate(invoice.dueAt, locale)}</span>
            ) : (
              <span className="text-muted-foreground">—</span>
            ),
            total: <Money amount={invoice.total} currency={invoice.currency} locale={locale} />,
            balance: (
              <Money
                amount={invoice.balanceDue}
                currency={invoice.currency}
                locale={locale}
                tone="strong"
              />
            ),
          },
        }))}
        empty={{ title: t('none'), body: t('noneBody') }}
      />
    </>
  )
}
