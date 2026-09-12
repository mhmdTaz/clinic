import { Schema, type InferSchemaType, type Model } from 'mongoose'
import { idField } from '../id'
import { getConnection } from '../connection'

/**
 * The transactional outbox (section 13.4).
 *
 * An event is written **inside the business transaction that caused it**, which is what makes
 * both halves of the classic failure impossible: "the appointment was booked but no confirmation
 * was sent", and its mirror image, "a confirmation went out for a booking that rolled back".
 * Nothing else in the system gets that property by trying harder — it comes from the write being
 * in the same transaction as the fact.
 *
 * Deliberately **not** tenant-guarded and **not** audited. The relay reads the collection across
 * every clinic — it is infrastructure, not a clinic's data — and an event is a record *of* an
 * audited change rather than a change of its own; auditing it would double every entry.
 *
 * A processed event is reclaimed by the TTL index rather than by a nightly job, because work the
 * database can do for us is work that cannot silently stop running (section 8.16).
 */
export const OutboxEventSchema = new Schema(
  {
    _id: idField,
    clinicId: { type: String, required: true },
    eventName: { type: String, required: true },
    payload: { type: Schema.Types.Mixed, default: {} },

    occurredAt: { type: Date, default: Date.now },
    /** Null until a relay has taken it and a handler has finished with it. */
    processedAt: { type: Date, default: null },
    attempts: { type: Number, default: 0 },
    lastError: { type: String, default: null },
    /** Set on success, some hours out; the TTL index sweeps from here. */
    expiresAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'outboxEvents' },
)

// The backstop sweep's query: anything still unprocessed, oldest first.
OutboxEventSchema.index({ processedAt: 1, occurredAt: 1 })
OutboxEventSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })
OutboxEventSchema.index({ clinicId: 1, eventName: 1, occurredAt: -1 })

export type OutboxEventDoc = InferSchemaType<typeof OutboxEventSchema> & { _id: string }

export const OutboxEventModel = (): Model<OutboxEventDoc> =>
  getConnection().models.OutboxEvent ??
  getConnection().model<OutboxEventDoc>('OutboxEvent', OutboxEventSchema)

/**
 * Where the change-stream relay left off.
 *
 * One document per relay, holding the last resume token it committed. A worker that restarts
 * resumes from the token instead of replaying from the beginning or, worse, skipping whatever
 * arrived while it was down.
 */
export const StreamCursorSchema = new Schema(
  {
    _id: { type: String, required: true },
    resumeToken: { type: Schema.Types.Mixed, default: null },
    updatedAt: { type: Date, default: Date.now },
  },
  { collection: 'streamCursors', versionKey: false },
)

export type StreamCursorDoc = InferSchemaType<typeof StreamCursorSchema> & { _id: string }

export const StreamCursorModel = (): Model<StreamCursorDoc> =>
  getConnection().models.StreamCursor ??
  getConnection().model<StreamCursorDoc>('StreamCursor', StreamCursorSchema)
