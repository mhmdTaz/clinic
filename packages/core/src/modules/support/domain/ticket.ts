import type { TicketStatus } from '@clinic/config'

/**
 * The ticket lifecycle (section 8.12).
 *
 *   OPEN ──clinic replies──> PENDING ──requester replies──> OPEN
 *     │                         │
 *     └──> IN_PROGRESS ─────────┴──> RESOLVED ──> CLOSED
 *                                       │
 *                                       └──requester replies──> OPEN
 *
 * OPEN and PENDING are both "not finished", and the difference between them is **who is holding
 * the ball**: PENDING means the clinic has answered and is waiting on the person who asked. A
 * queue that cannot tell those apart tells a front desk to chase itself.
 *
 * That is why a reply moves the status automatically rather than leaving somebody to remember:
 * the whole value of the distinction is that it is never stale.
 */
export const isOpen = (status: TicketStatus): boolean =>
  status === 'OPEN' || status === 'IN_PROGRESS' || status === 'PENDING'

/** A closed ticket takes no more replies. Reopening is a status change, deliberately. */
export const acceptsReplies = (status: TicketStatus): boolean => status !== 'CLOSED'

/**
 * Where a reply leaves the ticket.
 *
 * A clinic-side reply hands the ball to the requester; the requester replying hands it back —
 * including on a resolved ticket, because somebody writing again after "resolved" means it was
 * not. Null leaves the status alone, which is what an internal note does: a staff member talking
 * to their colleagues has not answered the patient.
 */
export function statusAfterReply(
  status: TicketStatus,
  author: 'CLINIC' | 'REQUESTER',
  isInternal: boolean,
): TicketStatus | null {
  if (isInternal) return null
  if (author === 'CLINIC') return status === 'PENDING' ? null : 'PENDING'
  // The requester has come back: it is the clinic's turn again, whatever it was before.
  return status === 'OPEN' ? null : 'OPEN'
}

/** Whether the clinic still owes a first answer — the number a front desk is judged on. */
export const awaitingFirstReply = (status: TicketStatus, firstReplyAt: Date | null): boolean =>
  firstReplyAt === null && isOpen(status)

const ORDER: Readonly<Record<TicketStatus, number>> = {
  OPEN: 0,
  IN_PROGRESS: 1,
  PENDING: 2,
  RESOLVED: 3,
  CLOSED: 4,
}

/** Sorts an inbox the way somebody works it: unanswered first, finished last. */
export const byUrgency = (left: TicketStatus, right: TicketStatus): number =>
  ORDER[left] - ORDER[right]
