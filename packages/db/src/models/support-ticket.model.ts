import { Schema, type InferSchemaType, type Model } from 'mongoose'
import { TICKET_CATEGORIES, TICKET_PRIORITIES, TICKET_STATUSES } from '@clinic/config'
import { idField } from '../id'
import { getConnection } from '../connection'
import { tenantGuard } from '../plugins/tenant-guard'
import { softDelete } from '../plugins/soft-delete'
import { auditCapture } from '../plugins/audit-capture'

const PersonRefSchema = new Schema({ id: String, name: String }, { _id: false })

/**
 * A support ticket and its whole conversation (section 8.12).
 *
 * The messages are embedded: opening a ticket is one read, posting a reply is one `$push`, and a
 * 2 KB message a hundred times over is 200 KB — three orders of magnitude under the document
 * limit. Bounded, always read together, meaningless apart: section 8.2's rule, satisfied.
 *
 * `isInternal` is the field the phase turns on. The patient-facing read filters internal notes
 * out **in the projection**, so a staff-only note cannot leak through a caller who forgot to
 * check — the same reasoning that keeps the note's visibility gate out of the UI layer.
 */
export const SupportTicketSchema = new Schema(
  {
    _id: idField,
    clinicId: { type: String, required: true },
    number: { type: String, required: true },

    subject: { type: String, required: true },
    category: { type: String, enum: TICKET_CATEGORIES, default: 'OTHER' },
    priority: { type: String, enum: TICKET_PRIORITIES, default: 'NORMAL' },
    status: { type: String, enum: TICKET_STATUSES, default: 'OPEN' },

    /** A patient, a doctor or a member of staff — whoever asked. */
    requester: {
      id: { type: String, required: true },
      name: { type: String, required: true },
      role: { type: String, required: true },
    },
    assignee: { type: PersonRefSchema, default: null },

    messages: [
      {
        _id: idField,
        author: { type: PersonRefSchema, default: null },
        body: { type: String, required: true },
        /** A staff-only note. Never returned to the person who opened the ticket. */
        isInternal: { type: Boolean, default: false },
        fileIds: [String],
        createdAt: { type: Date, default: Date.now },
      },
    ],

    /** The first time the clinic answered — what a response-time report is built from. */
    firstReplyAt: { type: Date, default: null },
    resolvedAt: { type: Date, default: null },
    closedAt: { type: Date, default: null },
    /** Kept denormalised so the inbox can sort by it without touching the messages. */
    lastMessageAt: { type: Date, default: Date.now },
  },
  { timestamps: true, collection: 'supportTickets' },
)

SupportTicketSchema.plugin(tenantGuard)
SupportTicketSchema.plugin(softDelete)
// A ticket can name a condition or a bill; who read it is a question worth being able to answer.
SupportTicketSchema.plugin(auditCapture, {
  model: 'SupportTicket',
  phiRead: true,
  // The thread is append-only and every message carries its own author and time; diffing the
  // whole array on every reply would bury the changes that matter.
  ignoredPaths: ['messages', 'lastMessageAt'],
})

SupportTicketSchema.index({ clinicId: 1, number: 1 }, { unique: true })
SupportTicketSchema.index({ clinicId: 1, status: 1, priority: -1, lastMessageAt: -1 }) // the inbox
SupportTicketSchema.index({ clinicId: 1, 'assignee.id': 1, status: 1 })
SupportTicketSchema.index({ clinicId: 1, 'requester.id': 1, createdAt: -1 })

export type SupportTicketDoc = InferSchemaType<typeof SupportTicketSchema> & { _id: string }

export const SupportTicketModel = (): Model<SupportTicketDoc> =>
  getConnection().models.SupportTicket ??
  getConnection().model<SupportTicketDoc>('SupportTicket', SupportTicketSchema)
