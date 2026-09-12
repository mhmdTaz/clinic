import type {
  OpenTicketRequest,
  ReplyToTicketRequest,
  TicketDetail,
  TicketListQuery,
  TicketSummary,
  UpdateTicketRequest,
} from '@clinic/contracts'
import { BusinessRuleError, ConflictError, ForbiddenError, NotFoundError } from '../../../errors'
import { runInTransaction } from '../../../transaction'
import { recordAudit } from '../../audit'
import { assertCan, holds, type Actor } from '../../access'
import { emitEvent } from '../../outbox'
import { findUser } from '../../identity'

import { acceptsReplies, awaitingFirstReply, statusAfterReply } from '../domain/ticket'
import {
  ticketRepository,
  type StoredTicket,
  type TicketFilter,
} from '../infrastructure/ticket.repository'

/**
 * Whether this actor is the clinic answering or the person who asked.
 *
 * `ticket:manage` is the clinic-side authority — it is what staff hold and what a patient and a
 * doctor do not. Everything that distinguishes the two sides of a conversation keys off this
 * single question rather than off a role name, so a clinic that invents a new support role gets
 * the right behaviour without anybody editing this file.
 */
const isClinicSide = (actor: Actor): boolean => holds(actor, 'ticket:manage')

export function toTicketSummary(ticket: StoredTicket, forActor: Actor): TicketSummary {
  const visible = visibleMessages(ticket, forActor)
  return {
    id: ticket.id,
    number: ticket.number,
    subject: ticket.subject,
    category: ticket.category,
    priority: ticket.priority,
    status: ticket.status,
    requester: ticket.requester,
    assignee: ticket.assignee,
    // Counted over what this reader may see, so a patient is never told there are messages
    // they cannot open.
    messageCount: visible.length,
    lastMessageAt: visible.at(-1)?.createdAt.toISOString() ?? null,
    awaitingFirstReply: awaitingFirstReply(ticket.status, ticket.firstReplyAt),
    createdAt: ticket.createdAt ? ticket.createdAt.toISOString() : null,
  }
}

export function toTicketDetail(ticket: StoredTicket, forActor: Actor): TicketDetail {
  return {
    ...toTicketSummary(ticket, forActor),
    messages: visibleMessages(ticket, forActor).map((message) => ({
      id: message.id,
      author: message.author,
      body: message.body,
      isInternal: message.isInternal,
      fileIds: message.fileIds,
      createdAt: message.createdAt.toISOString(),
    })),
    resolvedAt: ticket.resolvedAt ? ticket.resolvedAt.toISOString() : null,
    closedAt: ticket.closedAt ? ticket.closedAt.toISOString() : null,
  }
}

/**
 * **The one filter this phase turns on.** An internal note is staff-only, and it is removed here
 * — on the way out of the module — rather than left to whoever renders the thread. A note about
 * a patient is not a note for the patient, and the place to enforce that is the one place every
 * read passes through.
 */
function visibleMessages(ticket: StoredTicket, actor: Actor) {
  if (isClinicSide(actor)) return ticket.messages
  return ticket.messages.filter((message) => !message.isInternal)
}

/**
 * Asking for help (P9, D16, S11).
 *
 * Anybody with `ticket:create` may open one, and the requester is the caller — except for staff
 * writing down a phone call, who may name somebody else. The priority a patient sends is ignored:
 * how urgent something is, is the clinic's judgement, not the asker's.
 */
export async function openTicket(
  actor: Actor,
  input: OpenTicketRequest,
  now: Date = new Date(),
): Promise<TicketDetail> {
  await assertCan(actor, 'ticket:create')

  const clinicSide = isClinicSide(actor)
  let requester = { id: actor.userId, name: actor.displayName, role: primaryRole(actor) }

  if (input.requesterId && input.requesterId !== actor.userId) {
    // Only the clinic may open a ticket in somebody else's name.
    if (!clinicSide) throw new ForbiddenError('ticket:manage')
    const account = await findUser(actor.clinicId, input.requesterId)
    if (!account) throw new NotFoundError('User')
    requester = {
      id: account.id,
      name: `${account.firstName} ${account.lastName}`.trim(),
      role: account.preferredPortal ?? 'patient',
    }
  }

  const ticket = await runInTransaction(async (tx) => {
    const created = await ticketRepository.create(
      {
        clinicId: actor.clinicId,
        number: await ticketRepository.nextNumber(actor.clinicId),
        subject: input.subject,
        category: input.category,
        // A patient does not get to mark their own ticket urgent.
        priority: clinicSide ? input.priority : 'NORMAL',
        requester,
        message: {
          author: { id: actor.userId, name: actor.displayName },
          body: input.body,
          isInternal: false,
          fileIds: input.fileIds,
          createdAt: now,
        },
      },
      tx,
    )
    // Inside the transaction: the ticket and the intention to tell somebody are one write.
    await emitEvent(actor.clinicId, 'ticket.created', { ticketId: created.id }, tx, now)
    return created
  })

  await recordAudit({
    action: 'ticket.created',
    category: 'CLINICAL',
    severity: 'INFO',
    clinicId: actor.clinicId,
    entity: { type: 'SupportTicket', id: ticket.id },
    metadata: { number: ticket.number, category: ticket.category, requesterId: requester.id },
  })

  return toTicketDetail(ticket, actor)
}

/**
 * Answering (S11, P9).
 *
 * `isInternal` is refused outright for anybody who is not clinic-side, rather than silently
 * downgraded: a patient whose note was quietly made public would have no way of knowing.
 */
export async function replyToTicket(
  actor: Actor,
  ticketId: string,
  input: ReplyToTicketRequest,
  now: Date = new Date(),
): Promise<TicketDetail> {
  const facts = await ticketRepository.findAccessFacts(actor.clinicId, ticketId)
  if (!facts) throw new NotFoundError('Ticket')
  await assertCan(actor, 'ticket:reply', ticketResource(actor, facts))

  const clinicSide = isClinicSide(actor)
  if (input.isInternal && !clinicSide) {
    throw new ForbiddenError('ticket:manage')
  }
  if (!acceptsReplies(facts.status)) {
    throw new BusinessRuleError('TICKET_CLOSED', 'That ticket is closed. Open a new one.')
  }

  const author = clinicSide ? 'CLINIC' : 'REQUESTER'
  const nextStatus = statusAfterReply(facts.status, author, input.isInternal)

  const result = await runInTransaction(async (tx) => {
    const appended = await ticketRepository.appendMessage(
      actor.clinicId,
      ticketId,
      {
        author: { id: actor.userId, name: actor.displayName },
        body: input.body,
        isInternal: input.isInternal,
        fileIds: input.fileIds,
        createdAt: now,
      },
      {
        // An internal note is not the clinic answering, so it does not stop the response clock.
        isFirstClinicReply: clinicSide && !input.isInternal && facts.firstReplyAt === null,
        nextStatus,
      },
      tx,
    )
    if (!appended) {
      throw new ConflictError('TICKET_CLOSED', 'That ticket was closed a moment ago.')
    }

    // An internal note tells nobody: it is a conversation between colleagues.
    if (!input.isInternal) {
      await emitEvent(
        actor.clinicId,
        'ticket.replied',
        { ticketId, messageId: appended.messageId },
        tx,
        now,
      )
    }
    return appended
  })

  await recordAudit({
    action: input.isInternal ? 'ticket.note_added' : 'ticket.replied',
    category: 'CLINICAL',
    severity: 'INFO',
    clinicId: actor.clinicId,
    entity: { type: 'SupportTicket', id: ticketId },
    metadata: { number: facts.number, isInternal: input.isInternal },
  })

  return toTicketDetail(result.ticket, actor)
}

/** Triage: status, priority, category and who owns it. Clinic-side only. */
export async function updateTicket(
  actor: Actor,
  ticketId: string,
  input: UpdateTicketRequest,
  now: Date = new Date(),
): Promise<TicketDetail> {
  await assertCan(actor, 'ticket:manage')
  const facts = await ticketRepository.findAccessFacts(actor.clinicId, ticketId)
  if (!facts) throw new NotFoundError('Ticket')

  let assignee: { id: string; name: string } | null | undefined
  if (input.assigneeId !== undefined) {
    if (input.assigneeId === null) assignee = null
    else {
      const account = await findUser(actor.clinicId, input.assigneeId)
      if (!account) throw new NotFoundError('User')
      assignee = { id: account.id, name: `${account.firstName} ${account.lastName}`.trim() }
    }
  }

  const ticket = await ticketRepository.update(
    actor.clinicId,
    ticketId,
    { status: input.status, priority: input.priority, category: input.category, assignee },
    now,
  )
  if (!ticket) throw new NotFoundError('Ticket')

  // Somebody newly given a ticket should be told; reassigning to the same person should not.
  if (assignee && assignee.id !== facts.assigneeId) {
    await emitEvent(
      actor.clinicId,
      'ticket.assigned',
      { ticketId, assigneeId: assignee.id },
      undefined,
      now,
    )
  }

  await recordAudit({
    action: 'ticket.updated',
    category: 'CLINICAL',
    severity: 'INFO',
    clinicId: actor.clinicId,
    entity: { type: 'SupportTicket', id: ticketId },
    metadata: {
      number: ticket.number,
      status: input.status ?? null,
      priority: input.priority ?? null,
      assigneeId: assignee === undefined ? null : (assignee?.id ?? 'unassigned'),
    },
  })

  return toTicketDetail(ticket, actor)
}

export async function listTickets(actor: Actor, query: TicketListQuery): Promise<TicketSummary[]> {
  await assertCan(actor, 'ticket:read')

  const filter: TicketFilter = {
    status: query.status,
    priority: query.priority,
    category: query.category,
    q: query.q,
  }

  if (isClinicSide(actor)) {
    if (query.view === 'mine') filter.assigneeId = actor.userId
    else if (query.view === 'unassigned') filter.assigneeId = null
    else if (query.view === 'open' && !query.status) filter.unresolvedOnly = true
  } else {
    // Everybody else sees the tickets they opened, and nothing else. The scope is the filter,
    // not a permission check on each row.
    filter.requesterId = actor.userId
  }

  const tickets = await ticketRepository.list(actor.clinicId, filter)
  return tickets.map((ticket) => toTicketSummary(ticket, actor))
}

export async function getTicket(actor: Actor, ticketId: string): Promise<TicketDetail> {
  const facts = await ticketRepository.findAccessFacts(actor.clinicId, ticketId)
  if (!facts) throw new NotFoundError('Ticket')
  await assertCan(actor, 'ticket:read', ticketResource(actor, facts))

  const ticket = await ticketRepository.findById(actor.clinicId, ticketId)
  if (!ticket) throw new NotFoundError('Ticket')
  return toTicketDetail(ticket, actor)
}

/** For the worker: who should hear about a ticket, and what it says. */
export async function findTicketForNotification(clinicId: string, ticketId: string) {
  return ticketRepository.findById(clinicId, ticketId)
}

/**
 * Which side of the clinic asked — a patient, a doctor, the front desk. The portal rather than a
 * role key, because a clinic may invent any number of roles and the inbox only ever wants to know
 * whose question this is.
 */
const primaryRole = (actor: Actor): string => actor.preferredPortal ?? actor.portals[0] ?? 'patient'

export const ticketResource = (
  actor: Actor,
  ticket: { id: string; requesterId: string; assigneeId: string | null },
) => ({
  clinicId: actor.clinicId,
  type: 'SupportTicket',
  id: ticket.id,
  // The resolver reads these: OWN is the person who asked.
  userId: ticket.requesterId,
  assigneeId: ticket.assigneeId,
})
