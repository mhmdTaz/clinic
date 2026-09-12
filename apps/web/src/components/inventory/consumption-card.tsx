import type { ReactNode } from 'react'
import { getLocale, getTranslations } from 'next-intl/server'
import type { StockMovement } from '@clinic/contracts'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@clinic/ui'
import { EmptyState } from '@/components/portal/empty-state'
import { formatInstant } from '@/lib/format/dates'
import { Quantity } from './stock-badges'

/**
 * What a visit used (D15). Each row is a ledger entry, which is why it can say which batch the
 * stock came out of and what the shelf held afterwards — the two things a stock-take asks.
 */
export async function ConsumptionCard({
  movements,
  timeZone,
  action,
}: {
  movements: StockMovement[]
  timeZone: string
  action?: ReactNode
}) {
  const [t, locale] = await Promise.all([getTranslations('inventory.consume'), getLocale()])

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <CardTitle>{t('cardTitle')}</CardTitle>
          <CardDescription>{t('cardHint')}</CardDescription>
        </div>
        {movements.length > 0 ? action : null}
      </CardHeader>
      <CardContent>
        {movements.length === 0 ? (
          <EmptyState title={t('none')} body={t('noneBody')} action={action} />
        ) : (
          <ul className="divide-border flex flex-col divide-y">
            {movements.map((movement) => (
              <li
                key={movement.id}
                className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0"
              >
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="font-medium break-words">{movement.item.name}</span>
                  <span className="text-muted-foreground text-xs">
                    {formatInstant(movement.occurredAt, locale, timeZone)}
                    {movement.batchNumber
                      ? ` · ${t('batch', { number: movement.batchNumber })}`
                      : ''}
                    {movement.reason ? ` · ${movement.reason}` : ''}
                  </span>
                </span>
                <span className="flex flex-col items-end gap-0.5">
                  <Quantity
                    // The ledger stores it signed; the card is already headed "used".
                    value={movement.quantity.replace('-', '')}
                    unit={movement.item.unit}
                    tone="strong"
                  />
                  <span className="text-muted-foreground text-xs">
                    {t('leftAfter')}{' '}
                    <Quantity value={movement.balanceAfter} unit={movement.item.unit} />
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
