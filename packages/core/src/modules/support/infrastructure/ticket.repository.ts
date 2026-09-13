import { SupportTicketModel, newId, nextFormatted } from '@clinic/db'
import type { TicketCategory, TicketPriority, TicketStatus } from '@clinic/config'
import type { PersonRef } from '@clinic/contracts'
import { sessionOf, type Transaction } from '../../../transaction'
import {
  decodeCursor,
  keysetAfter,
  pageFrom,
  sortFor,
  type Page,
  type SortKey,
} from '../../../pagination'

export interface StoredMessage {
  id: string
  author: PersonRef | null
  body: string
  isInternal: boolean
  fileIds: string[]
  createdAt: Date
}

export interface StoredTicket {
  id: string
  number: string
  subject: string
  category: TicketCategory
  priority: TicketPriority
  status: TicketStatus
  requester: { id: string; name: string; role: string }
  assignee: PersonRef | null
  messages: StoredMessage[]
  firstReplyAt: Date | null
  resolvedAt: Date | null
  closedAt: Date | null
  lastMessageAt: Date | null
  createdAt: Date | null
}

interface MessageRecord {
  _id: string
  author?: PersonRef | null
  body: string
  isInternal?: boolean
  fileIds?: string[]
  createdAt?: Date | null
}

interface TicketRecord {
  _id: string
  number: string
  subject: string
  category?: TicketCategory
  priority?: TicketPriority
  status?: TicketStatus
  requester?: { id?: string; name?: string; role?: string } | null
  assignee?: PersonRef | null
  messages?: MessageRecord[]
  firstReplyAt?: Date | null
  resolvedAt?: Date | null
  closedAt?: Date | null
  lastMessageAt?: Date | null
  createdAt?: Date | null
}

const toMessage = (message: MessageRecord): StoredMessage => ({
  id: message._id,
  author: message.author ?? null,
  body: message.body,
  isInternal: message.isInternal ?? false,
  fileIds: message.fileIds ?? [],
  createdAt: message.createdAt ?? new Date(0),
})

const toTicket = (doc: TicketRecord): StoredTicket => ({
  id: doc._id,
  number: doc.number,
  subject: doc.subject,
  category: doc.category ?? 'OTHER',
  priority: doc.priority ?? 'NORMAL',
  status: doc.status ?? 'OPEN',
  requester: {
    id: doc.requester?.id ?? '',
    name: doc.requester?.name ?? '',
    role: doc.requester?.role ?? '',
  },
  assignee: doc.assignee ?? null,
  messages: (doc.messages ?? []).map(toMessage),
  firstReplyAt: doc.firstReplyAt ?? null,
  resolvedAt: doc.resolvedAt ?? null,
  closedAt: doc.closedAt ?? null,
  lastMessageAt: doc.lastMessageAt ?? null,
  createdAt: doc.createdAt ?? null,
})

export interface TicketFilter {
  status?: TicketStatus
  priority?: TicketPriority
  category?: TicketCategory
  requesterId?: string
  assigneeId?: string | null
  /** The inbox's default: everything the clinic still owes something on. */
  unresolvedOnly?: boolean
  q?: string
}

function filterFor(clinicId: string, filter: TicketFilter): Record<string, unknown> {
  const query: Record<string, unknown> = { clinicId }
  if (filter.status) query.status = filter.status
  if (filter.priority) query.priority = filter.priority
  if (filter.category) query.category = filter.category
  if (filter.requesterId) query['requester.id'] = filter.requesterId
  if (filter.assigneeId === null) query['assignee.id'] = { $in: [null, undefined] }
  else if (filter.assigneeId) query['assignee.id'] = filter.assigneeId
  if (filter.unresolvedOnly) query.status = { $in: ['OPEN', 'IN_PROGRESS', 'PENDING'] }
  if (filter.q) query.subject = new RegExp(escapeRegExp(filter.q), 'i')
  return query
}

/** `lastMessageAt` defaults to the moment a ticket is opened, so it is never null. */
const TICKET_ORDER: readonly SortKey[] = [
  { field: 'lastMessageAt', direction: -1, kind: 'date' },
  { field: '_id', direction: -1, kind: 'string' },
]

export const ticketRepository = {
  nextNumber(clinicId: string): Promise<string> {
    return nextFormatted(`ticket:${clinicId}`, 'TKT', 6)
  },

  async create(
    input: {
      clinicId: string
      number: string
      subject: string
      category: TicketCategory
      priority: TicketPriority
      requester: { id: string; name: string; role: string }
      message: Omit<StoredMessage, 'id'>
    },
    tx?: Transaction,
  ): Promise<StoredTicket> {
    const [doc] = await SupportTicketModel().create(
      [
        {
          _id: newId(),
          clinicId: input.clinicId,
          number: input.number,
          subject: input.subject,
          category: input.category,
          priority: input.priority,
          status: 'OPEN',
          requester: input.requester,
          messages: [{ _id: newId(), ...input.message }],
          lastMessageAt: input.message.createdAt,
        },
      ],
      { session: sessionOf(tx) },
    )
    if (!doc) throw new Error('Failed to write the ticket')
    return toTicket(doc.toObject() as TicketRecord)
  },

  async findById(clinicId: string, ticketId: string): Promise<StoredTicket | null> {
    const doc = (await SupportTicketModel()
      .findOne({ clinicId, _id: ticketId })
      .lean()) as TicketRecord | null
    return doc ? toTicket(doc) : null
  },

  /** The permission check's input; not audited, so a refusal is not recorded as a view. */
  async findAccessFacts(
    clinicId: string,
    ticketId: string,
  ): Promise<{
    id: string
    number: string
    subject: string
    status: TicketStatus
    requesterId: string
    assigneeId: string | null
    firstReplyAt: Date | null
  } | null> {
    const doc = (await SupportTicketModel()
      .findOne({ clinicId, _id: ticketId })
      .select({ number: 1, subject: 1, status: 1, requester: 1, assignee: 1, firstReplyAt: 1 })
      .setOptions({ skipAudit: true })
      .lean()) as TicketRecord | null
    if (!doc) return null
    return {
      id: doc._id,
      number: doc.number,
      subject: doc.subject,
      status: doc.status ?? 'OPEN',
      requesterId: doc.requester?.id ?? '',
      assigneeId: doc.assignee?.id ?? null,
      firstReplyAt: doc.firstReplyAt ?? null,
    }
  },

  /**
   * A page of tickets, latest activity first. Before Phase 10: at most 200, silently.
   *
   * Sorted on the latest message, which moves: a ticket answered while somebody pages through the
   * inbox jumps to the top and may be missed from the page after. That is the inbox doing its job —
   * it has just become the most recent — and a refresh shows it.
   */
  async list(
    clinicId: string,
    filter: TicketFilter,
    page: { cursor?: string; limit: number },
  ): Promise<Page<StoredTicket>> {
    const where = filterFor(clinicId, filter)
    if (page.cursor) {
      where.$and = [keysetAfter(TICKET_ORDER, decodeCursor(page.cursor, TICKET_ORDER.length))]
    }
    const docs = (await SupportTicketModel()
      .find(where)
      .sort(sortFor(TICKET_ORDER))
      .limit(page.limit + 1)
      .lean()) as unknown as Array<TicketRecord & Record<string, unknown>>
    const { docs: rows, nextCursor } = pageFrom(docs, page.limit, TICKET_ORDER)
    return { items: rows.map(toTicket), nextCursor }
  },

  /**
   * Posting a reply: one `$push`, which is what embedding the conversation buys.
   *
   * A closed ticket refuses the write in its filter rather than by a prior read, so two people
   * replying as it is being closed cannot both land. `firstReplyAt` is set only when it is still
   * null, and only for a clinic-side reply — the requester answering their own ticket is not the
   * clinic responding.
   */
  async appendMessage(
    clinicId: string,
    ticketId: string,
    message: Omit<StoredMessage, 'id'>,
    options: { isFirstClinicReply: boolean; nextStatus: TicketStatus | null },
    tx?: Transaction,
  ): Promise<{ ticket: StoredTicket; messageId: string } | null> {
    const messageId = newId()
    const set: Record<string, unknown> = { lastMessageAt: message.createdAt }
    if (options.nextStatus) set.status = options.nextStatus
    // `$set`, not `$min`: BSON orders null before every date, so `$min` against an unanswered
    // ticket keeps the null and the response clock never stops. The caller has already checked
    // that it is unset; two staff answering a never-answered ticket in the same instant would
    // leave whichever landed second, which is a sub-second difference in a response-time
    // metric and not worth a transaction.
    if (options.isFirstClinicReply) set.firstReplyAt = message.createdAt

    const doc = (await SupportTicketModel()
      .findOneAndUpdate(
        { clinicId, _id: ticketId, status: { $ne: 'CLOSED' } },
        { $push: { messages: { _id: messageId, ...message } }, $set: set },
        { new: true, session: sessionOf(tx) },
      )
      .lean()) as TicketRecord | null

    return doc ? { ticket: toTicket(doc), messageId } : null
  },

  async update(
    clinicId: string,
    ticketId: string,
    changes: {
      status?: TicketStatus
      priority?: TicketPriority
      category?: TicketCategory
      assignee?: PersonRef | null
    },
    now: Date,
  ): Promise<StoredTicket | null> {
    const set: Record<string, unknown> = {}
    if (changes.priority) set.priority = changes.priority
    if (changes.category) set.category = changes.category
    if (changes.assignee !== undefined) set.assignee = changes.assignee
    if (changes.status) {
      set.status = changes.status
      // Stamped on the way in and cleared on the way out, so "resolved when?" is answerable
      // even after a ticket is reopened and resolved again.
      set.resolvedAt = changes.status === 'RESOLVED' || changes.status === 'CLOSED' ? now : null
      set.closedAt = changes.status === 'CLOSED' ? now : null
    }

    const doc = (await SupportTicketModel()
      .findOneAndUpdate({ clinicId, _id: ticketId }, { $set: set }, { new: true })
      .lean()) as TicketRecord | null
    return doc ? toTicket(doc) : null
  },

  /** Who the clinic-side watchers of a ticket are — the assignee, where there is one. */
  async countOpenFor(clinicId: string, assigneeId: string): Promise<number> {
    return SupportTicketModel().countDocuments({
      clinicId,
      'assignee.id': assigneeId,
      status: { $in: ['OPEN', 'IN_PROGRESS', 'PENDING'] },
    })
  },
}

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
