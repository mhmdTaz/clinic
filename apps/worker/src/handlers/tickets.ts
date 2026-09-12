import { assertEventPayload, type OutboxEnvelope } from '@clinic/events'
import { usersHolding } from '@clinic/core/access'
import { deliver } from '@clinic/core/notifications'
import { findTicketForNotification } from '@clinic/core/support'

/**
 * Somebody asked for help. Two audiences, and they get different things:
 *
 *  - the person who asked gets a receipt, so they know it arrived;
 *  - whoever can work the queue gets an alert.
 *
 * "Whoever can work the queue" is resolved from `ticket:manage` rather than from a role name, so
 * a clinic that invents its own support role is covered without this file changing.
 */
export async function onTicketCreated(envelope: OutboxEnvelope): Promise<void> {
  const { ticketId } = assertEventPayload('ticket.created', envelope.payload)
  const ticket = await findTicketForNotification(envelope.clinicId, ticketId)
  if (!ticket) return

  await deliver({
    clinicId: envelope.clinicId,
    userIds: [ticket.requester.id],
    type: 'TICKET_REPLY',
    title: `We have your message — ${ticket.number}`,
    body: `Thanks for getting in touch about "${ticket.subject}". Someone at the clinic will reply, and you will find their answer here.`,
    href: `/support/${ticket.id}`,
    entity: { type: 'SupportTicket', id: ticket.id },
    dedupeKey: `ticket.received:${ticket.id}`,
  })

  const staff = await usersHolding(envelope.clinicId, 'ticket:manage')
  // The person who asked is told separately above; telling them twice would be odd even if
  // they happen to work here.
  const audience = staff.filter((userId) => userId !== ticket.requester.id)
  if (audience.length === 0) return

  await deliver({
    clinicId: envelope.clinicId,
    userIds: audience,
    type: 'TICKET_ASSIGNED',
    title: `New ticket ${ticket.number}`,
    body: `${ticket.requester.name} asked about "${ticket.subject}".`,
    href: `/staff/support/${ticket.id}`,
    entity: { type: 'SupportTicket', id: ticket.id },
    dedupeKey: `ticket.created:${ticket.id}`,
  })
}

/**
 * Somebody replied. The notification goes to **the other side of the conversation** — telling
 * people about their own message is the classic way to train them to ignore the bell.
 *
 * Internal notes never reach here: the module does not emit an event for them, because a note
 * between colleagues is not an answer to anybody.
 */
export async function onTicketReplied(envelope: OutboxEnvelope): Promise<void> {
  const { ticketId, messageId } = assertEventPayload('ticket.replied', envelope.payload)
  const ticket = await findTicketForNotification(envelope.clinicId, ticketId)
  if (!ticket) return

  const message = ticket.messages.find((entry) => entry.id === messageId)
  if (!message || message.isInternal) return

  const authorId = message.author?.id ?? null
  const fromRequester = authorId === ticket.requester.id

  // The clinic's turn: the assignee where there is one, everybody who works the queue otherwise
  // — an unassigned ticket is nobody's and therefore everybody's.
  const clinicSide = ticket.assignee?.id
    ? [ticket.assignee.id]
    : (await usersHolding(envelope.clinicId, 'ticket:manage')).filter(
        (userId) => userId !== authorId,
      )
  const audience = fromRequester ? clinicSide : [ticket.requester.id]

  if (audience.length === 0) return

  await deliver({
    clinicId: envelope.clinicId,
    userIds: audience,
    type: 'TICKET_REPLY',
    title: `Reply on ${ticket.number}`,
    body: `${message.author?.name ?? 'Someone'} replied about "${ticket.subject}".`,
    emailBody: `${message.author?.name ?? 'Someone'} replied about "${ticket.subject}":\n\n${message.body}`,
    href: fromRequester ? `/staff/support/${ticket.id}` : `/support/${ticket.id}`,
    entity: { type: 'SupportTicket', id: ticket.id },
    // Per message, not per ticket: two replies are two notifications, and one retry is none.
    dedupeKey: `ticket.replied:${messageId}`,
  })
}

/** Somebody was handed a ticket. Only they need to know. */
export async function onTicketAssigned(envelope: OutboxEnvelope): Promise<void> {
  const { ticketId, assigneeId } = assertEventPayload('ticket.assigned', envelope.payload)
  const ticket = await findTicketForNotification(envelope.clinicId, ticketId)
  if (!ticket) return

  await deliver({
    clinicId: envelope.clinicId,
    userIds: [assigneeId],
    type: 'TICKET_ASSIGNED',
    title: `${ticket.number} is yours`,
    body: `You have been given "${ticket.subject}" from ${ticket.requester.name}.`,
    href: `/staff/support/${ticket.id}`,
    entity: { type: 'SupportTicket', id: ticket.id },
    dedupeKey: `ticket.assigned:${ticket.id}:${assigneeId}`,
  })
}
