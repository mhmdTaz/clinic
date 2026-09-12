import { z } from 'zod'
import { PersonRef, requiredText } from './common'

/**
 * Contracts for support tickets (P9, S11, D16).
 *
 * The shape that matters is `TicketMessage`: a reply is either public or an internal note, and
 * the patient-facing read filters the internal ones out in the projection rather than in a
 * caller's `if`. A note a doctor wrote about a patient is not a note for the patient.
 */

export const TicketStatus = z.enum(['OPEN', 'IN_PROGRESS', 'PENDING', 'RESOLVED', 'CLOSED'])
export type TicketStatus = z.infer<typeof TicketStatus>

export const TicketPriority = z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT'])
export type TicketPriority = z.infer<typeof TicketPriority>

export const TicketCategory = z.enum([
  'APPOINTMENT',
  'BILLING',
  'MEDICAL_RECORDS',
  'TECHNICAL',
  'OTHER',
])
export type TicketCategory = z.infer<typeof TicketCategory>

export const OpenTicketRequest = z.object({
  subject: requiredText(160),
  category: TicketCategory.default('OTHER'),
  /** Only the clinic sets this; a request from a patient has it ignored. */
  priority: TicketPriority.default('NORMAL'),
  body: requiredText(4000),
  fileIds: z.array(z.string().max(64)).max(5).default([]),
  /** Staff opening a ticket on somebody's behalf — a phone call written down. */
  requesterId: z.string().max(64).nullable().default(null),
})
export type OpenTicketRequest = z.infer<typeof OpenTicketRequest>

export const ReplyToTicketRequest = z.object({
  body: requiredText(4000),
  /**
   * A staff-only note on the thread. Refused outright for anybody who is not clinic-side, so
   * "internal" cannot be set by the person it would be hidden from.
   */
  isInternal: z.boolean().default(false),
  fileIds: z.array(z.string().max(64)).max(5).default([]),
})
export type ReplyToTicketRequest = z.infer<typeof ReplyToTicketRequest>

export const UpdateTicketRequest = z.object({
  status: TicketStatus.optional(),
  priority: TicketPriority.optional(),
  category: TicketCategory.optional(),
  /** Null unassigns; absent leaves it alone. */
  assigneeId: z.string().max(64).nullable().optional(),
})
export type UpdateTicketRequest = z.infer<typeof UpdateTicketRequest>

export const TicketMessage = z.object({
  id: z.string(),
  author: PersonRef.nullable(),
  body: z.string(),
  isInternal: z.boolean(),
  fileIds: z.array(z.string()),
  createdAt: z.string().datetime(),
})
export type TicketMessage = z.infer<typeof TicketMessage>

export const TicketSummary = z.object({
  id: z.string(),
  number: z.string(),
  subject: z.string(),
  category: TicketCategory,
  priority: TicketPriority,
  status: TicketStatus,
  requester: z.object({ id: z.string(), name: z.string(), role: z.string() }),
  assignee: PersonRef.nullable(),
  /** Counts only what this reader may see, so a patient is never told about hidden notes. */
  messageCount: z.number(),
  lastMessageAt: z.string().datetime().nullable(),
  /** Whether the clinic still owes a first reply — the number a front desk is judged on. */
  awaitingFirstReply: z.boolean(),
  createdAt: z.string().datetime().nullable(),
})
export type TicketSummary = z.infer<typeof TicketSummary>

export const TicketDetail = TicketSummary.extend({
  messages: z.array(TicketMessage),
  resolvedAt: z.string().datetime().nullable(),
  closedAt: z.string().datetime().nullable(),
})
export type TicketDetail = z.infer<typeof TicketDetail>

export const TicketListQuery = z.object({
  status: TicketStatus.optional(),
  priority: TicketPriority.optional(),
  category: TicketCategory.optional(),
  /** "mine" is the assignee's own queue; the inbox defaults to everything unresolved. */
  view: z.enum(['open', 'mine', 'unassigned', 'all']).default('open'),
  q: z.string().trim().max(80).optional(),
})
export type TicketListQuery = z.infer<typeof TicketListQuery>
