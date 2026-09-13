import type { Metadata } from 'next'
import { getLocale, getTranslations } from 'next-intl/server'
import type { InventoryListQuery } from '@clinic/contracts'
import { holds } from '@clinic/core/access'
import { listCategories, listItems, listSuppliers, stockAlerts } from '@clinic/core/inventory'
import { Alert } from '@clinic/ui'
import { ItemDialog } from '@/components/inventory/item-dialog'
import { Quantity, StockBadges } from '@/components/inventory/stock-badges'
import { Money } from '@/components/billing/money'
import { DataTable } from '@/components/data-table/data-table'
import { PageHeader } from '@/components/portal/page-header'
import { requirePortal } from '@/lib/auth/server-session'
import { formatCalendarDate } from '@/lib/format/dates'
import { param, type SearchParams } from '@/lib/server/page-helpers'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('staff.inventory')
  return { title: t('title') }
}

const VIEWS = ['all', 'low', 'expiring'] as const
const isView = (value: string | undefined): value is (typeof VIEWS)[number] =>
  value !== undefined && (VIEWS as readonly string[]).includes(value)

/**
 * What is on the shelf (S10).
 *
 * The banner is the reason anybody opens this page in the morning: what is about to run out and
 * what is about to go off. Both are read from the shelf as it is now rather than from a stored
 * flag, so a nightly job that stopped running could never leave it looking healthy.
 */
export default async function InventoryPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requirePortal('staff')
  const values = await searchParams
  const view = param(values, 'view')

  const query: Partial<InventoryListQuery> & { view: 'all' | 'low' | 'expiring' } = {
    q: param(values, 'q')?.slice(0, 80),
    status: 'active',
    view: isView(view) ? view : 'all',
    cursor: param(values, 'cursor'),
    limit: 50,
  }

  const canManage = holds(actor, 'inventory:manage')
  const [page, alerts, categories, suppliers, t, tItem, locale] = await Promise.all([
    listItems(actor, query),
    stockAlerts(actor),
    canManage ? listCategories(actor) : [],
    canManage ? listSuppliers(actor) : [],
    getTranslations('staff.inventory'),
    getTranslations('inventory.item'),
    getLocale(),
  ])

  const items = page.items
  const currency = items[0]?.currency ?? alerts.low[0]?.currency ?? 'USD'
  const attention = alerts.low.length + alerts.expiring.length + alerts.expired.length

  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          canManage ? (
            <ItemDialog
              categories={categories}
              suppliers={suppliers}
              currency={currency}
              label={tItem('actions.add')}
            />
          ) : null
        }
      />

      {attention > 0 ? (
        <Alert tone={alerts.expired.length > 0 ? 'danger' : 'warning'} className="mb-4">
          <span data-testid="stock-alerts">
            {[
              alerts.low.length > 0 ? t('alerts.low', { count: alerts.low.length }) : null,
              alerts.expiring.length > 0
                ? t('alerts.expiring', { count: alerts.expiring.length })
                : null,
              alerts.expired.length > 0
                ? t('alerts.expired', { count: alerts.expired.length })
                : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </Alert>
      ) : null}

      <DataTable
        label={t('title')}
        search={{ placeholder: t('searchHint'), value: query.q ?? '' }}
        columns={[
          { id: 'item', header: t('columns.item'), priority: 1 },
          { id: 'state', header: t('columns.state'), priority: 2 },
          { id: 'expiry', header: t('columns.expiry'), priority: 3 },
          { id: 'price', header: t('columns.price'), priority: 3, align: 'end' },
          { id: 'onHand', header: t('columns.onHand'), priority: 1, align: 'end' },
        ]}
        filters={[
          {
            param: 'view',
            label: t('columns.state'),
            value: query.view,
            options: [
              { value: 'all', label: t('views.all') },
              { value: 'low', label: t('views.low') },
              { value: 'expiring', label: t('views.expiring') },
            ],
          },
        ]}
        nextCursor={page.nextCursor}
        rows={items.map((item) => ({
          id: item.id,
          href: `/staff/inventory/${item.id}`,
          cells: {
            item: (
              <span className="flex min-w-0 flex-col">
                <span className="font-medium break-words">{item.name}</span>
                <span className="text-muted-foreground text-xs font-normal tabular-nums">
                  {item.sku}
                  {item.category ? ` · ${item.category.name}` : ''}
                </span>
              </span>
            ),
            state: (
              <StockBadges
                item={item}
                labels={{
                  low: tItem('low'),
                  expiring: tItem('expiring'),
                  expired: tItem('expired'),
                  retired: tItem('retired'),
                }}
              />
            ),
            expiry: item.nextExpiryAt ? (
              <span className="tabular-nums">{formatCalendarDate(item.nextExpiryAt, locale)}</span>
            ) : (
              <span className="text-muted-foreground">—</span>
            ),
            price: item.salePrice ? (
              <Money amount={item.salePrice} currency={item.currency} locale={locale} />
            ) : (
              <span className="text-muted-foreground">—</span>
            ),
            onHand: item.isTracked ? (
              <Quantity value={item.quantityOnHand} unit={item.unit} tone="strong" />
            ) : (
              <span className="text-muted-foreground text-xs">{tItem('untracked')}</span>
            ),
          },
        }))}
        empty={{ title: t('none'), body: t('noneBody') }}
      />
    </>
  )
}
