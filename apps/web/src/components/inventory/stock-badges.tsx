import { displayQuantity } from '@clinic/contracts'
import type { InventoryItemSummary, StockMovementType } from '@clinic/contracts'
import { Badge, cn } from '@clinic/ui'

/**
 * How an item is doing, in words as well as colour (section 14.5).
 *
 * Expired is its own badge rather than the far end of expiring, because they call for different
 * actions: one is a reminder to order, the other is a job to do today.
 */
export function StockBadges({
  item,
  labels,
}: {
  item: InventoryItemSummary
  labels: { low: string; expiring: string; expired: string; retired: string }
}) {
  return (
    <span className="flex flex-wrap items-center gap-1.5" data-testid="stock-badges">
      {item.isActive ? null : <Badge tone="neutral">{labels.retired}</Badge>}
      {item.isLow ? <Badge tone="warning">{labels.low}</Badge> : null}
      {item.hasExpired ? <Badge tone="danger">{labels.expired}</Badge> : null}
      {item.isExpiringSoon ? <Badge tone="warning">{labels.expiring}</Badge> : null}
    </span>
  )
}

/**
 * A count and its unit. Stored at three decimal places so the arithmetic never drifts; shown the
 * way a person would write it, because "2.000 vial" is not how anybody counts.
 */
export function Quantity({
  value,
  unit,
  className,
  tone,
}: {
  value: string
  unit?: string
  className?: string
  tone?: 'muted' | 'strong'
}) {
  return (
    <span
      className={cn(
        'tabular-nums',
        tone === 'muted' && 'text-muted-foreground',
        tone === 'strong' && 'font-semibold',
        className,
      )}
    >
      {displayQuantity(value)}
      {unit ? ` ${unit}` : ''}
    </span>
  )
}

const MOVEMENT_TONES: Record<StockMovementType, 'success' | 'info' | 'warning' | 'neutral'> = {
  RECEIPT: 'success',
  RETURN: 'success',
  CONSUMPTION: 'info',
  WASTAGE: 'warning',
  ADJUSTMENT: 'neutral',
}

export function MovementBadge({ type, label }: { type: StockMovementType; label: string }) {
  return <Badge tone={MOVEMENT_TONES[type]}>{label}</Badge>
}
