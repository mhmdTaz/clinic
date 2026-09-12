import { Badge } from '@clinic/ui'
import type { TicketPriority, TicketStatus } from '@clinic/contracts'

const STATUS_TONES = {
  OPEN: 'info',
  IN_PROGRESS: 'warning',
  PENDING: 'neutral',
  RESOLVED: 'success',
  CLOSED: 'neutral',
} as const

/**
 * Colour and words together (14.5). OPEN and PENDING are both unfinished but differ in who is
 * holding the ball, so they read differently rather than sharing a colour.
 */
export function TicketStatusBadge({ status, label }: { status: TicketStatus; label: string }) {
  return (
    <Badge tone={STATUS_TONES[status]} data-testid="ticket-status">
      {label}
    </Badge>
  )
}

const PRIORITY_TONES = {
  LOW: 'neutral',
  NORMAL: 'neutral',
  HIGH: 'warning',
  URGENT: 'danger',
} as const

/** Normal is the common case and says nothing; a badge for it would be noise on every row. */
export function TicketPriorityBadge({
  priority,
  label,
}: {
  priority: TicketPriority
  label: string
}) {
  if (priority === 'NORMAL' || priority === 'LOW') return null
  return <Badge tone={PRIORITY_TONES[priority]}>{label}</Badge>
}
