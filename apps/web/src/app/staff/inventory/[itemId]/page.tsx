import type { Metadata } from 'next'
import { getLocale, getTranslations } from 'next-intl/server'
import { localDateIn } from '@clinic/contracts'
import { holds } from '@clinic/core/access'
import { getClinicSessionInfo } from '@clinic/core/clinic'
import {
  getItem,
  listCategories,
  listMovements,
  listSuppliers,
  reconcileItem,
} from '@clinic/core/inventory'
import { Alert, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@clinic/ui'
import { Money } from '@/components/billing/money'
import { ItemDialog } from '@/components/inventory/item-dialog'
import { MovementBadge, Quantity, StockBadges } from '@/components/inventory/stock-badges'
import { AdjustStockDialog, ReceiveStockDialog } from '@/components/inventory/stock-dialogs'
import { EmptyState } from '@/components/portal/empty-state'
import { PageHeader } from '@/components/portal/page-header'
import { requirePortal } from '@/lib/auth/server-session'
import { formatCalendarDate, formatInstant } from '@/lib/format/dates'
import { orNotFound, type RouteParams } from '@/lib/server/page-helpers'

export async function generateMetadata({
  params,
}: {
  params: RouteParams<'itemId'>
}): Promise<Metadata> {
  const actor = await requirePortal('staff')
  const item = await getItem(actor, (await params).itemId).catch(() => null)
  const t = await getTranslations('staff.inventory')
  return { title: item ? item.name : t('title') }
}

/**
 * One item: what it is, which batches hold it, and the ledger that explains the number.
 *
 * The reconciliation line is the point of the whole design. `quantityOnHand` is a projection of
 * the movements, so summing the ledger must give the same answer — and this page says out loud
 * whether it does, rather than asking anybody to take it on trust (section 8.11).
 */
export default async function InventoryItemPage({ params }: { params: RouteParams<'itemId'> }) {
  const actor = await requirePortal('staff')
  const { itemId } = await params

  const item = await orNotFound(getItem(actor, itemId))
  const canManage = holds(actor, 'inventory:manage')
  const [clinic, movements, reconciliation, categories, suppliers, t, tType, locale] =
    await Promise.all([
      getClinicSessionInfo(actor.clinicId),
      listMovements(actor, { itemId }),
      reconcileItem(actor, itemId),
      canManage ? listCategories(actor) : [],
      canManage ? listSuppliers(actor) : [],
      getTranslations('inventory.item'),
      getTranslations('inventory.movements'),
      getLocale(),
    ])
  const today = localDateIn(clinic.timezone)

  return (
    <>
      <PageHeader
        title={item.name}
        subtitle={`${item.sku}${item.category ? ` · ${item.category.name}` : ''}`}
        badges={
          <StockBadges
            item={item}
            labels={{
              low: t('low'),
              expiring: t('expiring'),
              expired: t('expired'),
              retired: t('retired'),
            }}
          />
        }
        back={{ href: '/staff/inventory', label: t('back') }}
        actions={
          <span className="flex flex-wrap items-center gap-2">
            {canManage && item.isTracked ? (
              <ReceiveStockDialog item={item} today={today} label={t('actions.receive')} />
            ) : null}
            {holds(actor, 'inventory:adjust') ? (
              <AdjustStockDialog item={item} label={t('actions.adjust')} />
            ) : null}
            {canManage ? (
              <ItemDialog
                item={item}
                categories={categories}
                suppliers={suppliers}
                currency={item.currency}
                label={t('actions.edit')}
              />
            ) : null}
          </span>
        }
      />

      {reconciliation.agrees ? null : (
        <Alert tone="danger" className="mb-4">
          {t('doesNotReconcile', {
            onHand: reconciliation.quantityOnHand,
            ledger: reconciliation.ledgerTotal,
          })}
        </Alert>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{t('batches')}</CardTitle>
            <CardDescription>{t('batchesHint')}</CardDescription>
          </CardHeader>
          <CardContent>
            {!item.isTracked ? (
              <EmptyState title={t('untracked')} body={t('untrackedBody')} />
            ) : item.batches.length === 0 ? (
              <EmptyState title={t('noBatches')} body={t('noBatchesBody')} />
            ) : (
              <ul className="divide-border flex flex-col divide-y">
                {item.batches.map((batch) => {
                  const expired = batch.expiresAt !== null && batch.expiresAt < today
                  return (
                    <li
                      key={batch.id}
                      className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0"
                    >
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className="font-medium">{batch.batchNumber ?? t('unnumbered')}</span>
                        <span className="text-muted-foreground text-xs">
                          {batch.expiresAt
                            ? t(expired ? 'expiredOn' : 'expiresOn', {
                                date: formatCalendarDate(batch.expiresAt, locale),
                              })
                            : t('noExpiry')}
                          {batch.receivedAt
                            ? ` · ${t('receivedOn', {
                                date: formatInstant(batch.receivedAt, locale, clinic.timezone),
                              })}`
                            : ''}
                        </span>
                      </span>
                      <Quantity
                        value={batch.quantity}
                        unit={item.unit}
                        tone="strong"
                        className={expired ? 'text-muted-foreground line-through' : undefined}
                      />
                    </li>
                  )
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('summary')}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="flex flex-col gap-2 text-sm">
              <Row label={t('onHand')}>
                <Quantity
                  value={item.quantityOnHand}
                  unit={item.unit}
                  tone="strong"
                  className="text-base"
                />
              </Row>
              <Row label={t('ledgerTotal')}>
                <span data-testid="ledger-total">
                  <Quantity value={reconciliation.ledgerTotal} unit={item.unit} />
                </span>
              </Row>
              <Row label={t('reorderLevel')}>
                <Quantity value={item.reorderLevel} unit={item.unit} />
              </Row>
              <Row label={t('costPrice')}>
                {item.costPrice ? (
                  <Money amount={item.costPrice} currency={item.currency} locale={locale} />
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </Row>
              <Row label={t('salePrice')}>
                {item.salePrice ? (
                  <Money amount={item.salePrice} currency={item.currency} locale={locale} />
                ) : (
                  <span className="text-muted-foreground">{t('notBillable')}</span>
                )}
              </Row>
              {item.supplier ? <Row label={t('supplier')}>{item.supplier.name}</Row> : null}
            </dl>
            {item.description ? (
              <p className="text-muted-foreground mt-3 text-sm">{item.description}</p>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>{tType('title')}</CardTitle>
          <CardDescription>{tType('hint')}</CardDescription>
        </CardHeader>
        <CardContent>
          {movements.length === 0 ? (
            <EmptyState title={tType('none')} />
          ) : (
            <ul className="divide-border flex flex-col divide-y">
              {movements.map((movement) => (
                <li
                  key={movement.id}
                  className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0"
                >
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <MovementBadge type={movement.type} label={tType(`types.${movement.type}`)} />
                      <span className="text-muted-foreground text-xs">
                        {formatInstant(movement.occurredAt, locale, clinic.timezone)}
                        {movement.performedBy ? ` · ${movement.performedBy.name}` : ''}
                      </span>
                    </span>
                    {movement.reason || movement.batchNumber || movement.reference ? (
                      <span className="text-muted-foreground text-xs break-words">
                        {[
                          movement.batchNumber
                            ? tType('batch', { number: movement.batchNumber })
                            : null,
                          movement.reference,
                          movement.reason,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    ) : null}
                  </span>
                  <span className="flex flex-col items-end gap-0.5">
                    <Quantity
                      value={movement.quantity}
                      unit={item.unit}
                      tone="strong"
                      className={
                        movement.quantity.startsWith('-') ? 'text-muted-foreground' : undefined
                      }
                    />
                    <span className="text-muted-foreground text-xs">
                      {tType('balanceAfter')}{' '}
                      <Quantity value={movement.balanceAfter} unit={item.unit} />
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}
