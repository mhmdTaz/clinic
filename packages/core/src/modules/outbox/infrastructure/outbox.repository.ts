import { OutboxEventModel, StreamCursorModel, newId } from '@clinic/db'
import { OUTBOX_RETENTION_HOURS } from '@clinic/config'
import type { EventName, OutboxEnvelope } from '@clinic/events'
import { sessionOf, type Transaction } from '../../../transaction'

interface OutboxRecord {
  _id: string
  clinicId: string
  eventName: string
  payload?: unknown
  occurredAt?: Date | null
  processedAt?: Date | null
  attempts?: number
}

const toEnvelope = (doc: OutboxRecord): OutboxEnvelope => ({
  id: doc._id,
  clinicId: doc.clinicId,
  eventName: doc.eventName as EventName,
  payload: doc.payload ?? {},
  occurredAt: doc.occurredAt ?? new Date(0),
  attempts: doc.attempts ?? 0,
})

export const outboxRepository = {
  /**
   * Writes the event. The caller's transaction is what gives it its guarantee — an event outside
   * one is a promise nobody is keeping.
   */
  async append(
    input: { clinicId: string; eventName: string; payload: unknown; occurredAt: Date },
    tx?: Transaction,
  ): Promise<string> {
    const id = newId()
    await OutboxEventModel().create([{ _id: id, ...input }], { session: sessionOf(tx) })
    return id
  },

  async findById(eventId: string): Promise<OutboxEnvelope | null> {
    const doc = (await OutboxEventModel().findById(eventId).lean()) as OutboxRecord | null
    return doc ? toEnvelope(doc) : null
  },

  /**
   * Marks an event done, conditionally on it not already being done.
   *
   * False means somebody else finished it first — which is the ordinary outcome when the change
   * stream and the backstop sweep both reach the same event, and exactly why this is a
   * conditional update rather than a set.
   */
  async markProcessed(eventId: string, at: Date): Promise<boolean> {
    const expiresAt = new Date(at.getTime() + OUTBOX_RETENTION_HOURS * 3_600_000)
    const result = await OutboxEventModel().updateOne(
      { _id: eventId, processedAt: null },
      { $set: { processedAt: at, expiresAt, lastError: null } },
    )
    return result.modifiedCount > 0
  },

  /** Records a failure and counts the attempt; the event stays pending for the next try. */
  async markFailed(eventId: string, error: string): Promise<void> {
    await OutboxEventModel().updateOne(
      { _id: eventId, processedAt: null },
      { $set: { lastError: error.slice(0, 500) }, $inc: { attempts: 1 } },
    )
  },

  /**
   * The backstop sweep (section 13.4): anything still unprocessed and older than `before`.
   *
   * The age cut-off is what keeps the sweep from racing the stream — an event inserted a second
   * ago is almost certainly already on a queue, and picking it up too would just make two
   * handlers contend for the same conditional update.
   */
  async pendingBefore(before: Date, limit = 100): Promise<OutboxEnvelope[]> {
    const docs = (await OutboxEventModel()
      .find({ processedAt: null, occurredAt: { $lt: before } })
      .sort({ occurredAt: 1 })
      .limit(limit)
      .lean()) as OutboxRecord[]
    return docs.map(toEnvelope)
  },

  async countPending(): Promise<number> {
    return OutboxEventModel().countDocuments({ processedAt: null })
  },
}

/** Where a change-stream relay left off, so a restart resumes rather than replays or skips. */
export const streamCursorRepository = {
  async read(name: string): Promise<unknown | null> {
    const doc = await StreamCursorModel().findById(name).lean()
    return doc?.resumeToken ?? null
  },

  async save(name: string, resumeToken: unknown): Promise<void> {
    await StreamCursorModel().updateOne(
      { _id: name },
      { $set: { resumeToken, updatedAt: new Date() } },
      { upsert: true },
    )
  },
}
