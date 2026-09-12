import { OutboxEventModel } from '@clinic/db'
import type { EventName, OutboxEnvelope } from '@clinic/events'
import { streamCursorRepository } from './outbox.repository'

/**
 * The relay's fast path: a change stream on `outboxEvents` (section 13.4).
 *
 * **Push, not poll.** A worker opens a stream filtered to inserts and reacts as each event
 * replicates, so latency is milliseconds rather than a poll interval. The driver lives here
 * rather than in the worker because a change stream is a database concern, and `apps/**` is
 * forbidden from importing the driver for exactly that reason.
 *
 * Restarts resume from a **stored resume token** rather than replaying from the beginning or,
 * worse, skipping whatever arrived while the worker was down. The token is saved only after the
 * handler for that event has been accepted — saving it on receipt would turn a crash mid-handler
 * into a silently dropped event.
 *
 * The stream is the fast path; it is not the guarantee. A token older than the oplog can no
 * longer resume, and a stream can gap. The backstop sweep over `processedAt: null` is what makes
 * delivery certain, and it is why `markProcessed` is conditional — the two paths racing to the
 * same event is the ordinary case, not an error.
 */
export interface OutboxWatcher {
  close: () => Promise<void>
}

export async function watchOutbox(
  name: string,
  onEvent: (envelope: OutboxEnvelope) => Promise<void>,
  onError: (error: unknown) => void,
): Promise<OutboxWatcher> {
  const resumeAfter = await streamCursorRepository.read(name)

  const stream = OutboxEventModel().watch<{
    _id: string
    clinicId: string
    eventName: string
    payload?: unknown
    occurredAt?: Date
    attempts?: number
  }>([{ $match: { operationType: 'insert' } }], {
    fullDocument: 'default',
    // A token from a previous run, when there is one. Absent, the stream starts from now —
    // which is correct, because anything older is the sweep's to find.
    ...(resumeAfter ? { resumeAfter: resumeAfter as never } : {}),
  })

  stream.on('change', (change) => {
    void (async () => {
      try {
        const document = (change as { fullDocument?: Record<string, unknown> }).fullDocument
        if (!document) return

        await onEvent({
          id: String(document._id),
          clinicId: String(document.clinicId),
          eventName: String(document.eventName) as EventName,
          payload: document.payload ?? {},
          occurredAt: (document.occurredAt as Date | undefined) ?? new Date(),
          attempts: (document.attempts as number | undefined) ?? 0,
        })

        // Only once the handler has accepted it: a crash between receiving and enqueuing must
        // leave the token where it was, so the event comes round again.
        const token = (change as { _id?: unknown })._id
        if (token) await streamCursorRepository.save(name, token)
      } catch (error) {
        onError(error)
      }
    })()
  })

  stream.on('error', onError)

  return {
    async close() {
      await stream.close()
    },
  }
}
