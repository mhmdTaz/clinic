import './bootstrap-env'
import { env } from '@clinic/config'
import { isEventName, type OutboxEnvelope } from '@clinic/events'
import { bootstrapServer, connect, disconnect, flushAudit } from '@clinic/core/server'
import { outboxRepository, watchOutbox, type OutboxWatcher } from '@clinic/core/outbox'
import { handlerFor } from './handlers'
import { sweepReminders } from './jobs/reminders'
import { closeQueues, queue, schedule, startWorker } from './queues'

/**
 * The worker (sections 13.4, 13.5).
 *
 * Three things run here, and the relationship between the first two is the design:
 *
 *  1. **the relay** — a change stream on `outboxEvents` that enqueues each event as it
 *     replicates. Push, not poll: latency is milliseconds, and a restart resumes from a stored
 *     token rather than replaying or skipping.
 *  2. **the backstop sweep** — a slower pass over anything still unprocessed. The stream is the
 *     fast path; this is the guarantee. A resume token older than the oplog cannot resume, and a
 *     stream can gap; neither costs an event, because the sweep will find it.
 *  3. **the reminder sweep** — appointment reminders, read from the diary each tick.
 *
 * Both paths racing to the same event is the **ordinary case, not an error**, which is why
 * `markProcessed` is a conditional update and why every handler is idempotent (ADR-0030).
 */

const RELAY_NAME = 'outbox-relay'
const BACKSTOP_EVERY_MS = 60_000
const REMINDER_EVERY_MS = 5 * 60_000
/** Events younger than this are the stream's; sweeping them too would just make the two race. */
const BACKSTOP_GRACE_MS = 30_000

let watcher: OutboxWatcher | null = null

/**
 * Runs one event through its handler and marks it done.
 *
 * `markProcessed` is conditional, so the loser of a race is told so and stops. A handler that
 * throws leaves the event unprocessed, which is what lets BullMQ retry it and, failing that, the
 * backstop sweep pick it up again.
 */
async function runEvent(eventId: string): Promise<void> {
  const envelope = await outboxRepository.findById(eventId)
  if (!envelope) return

  if (!isEventName(envelope.eventName)) {
    // An event this build has never heard of. Marking it processed rather than retrying it
    // forever is deliberate: a rolled-back deploy should not fill the dead-letter queue.
    await outboxRepository.markProcessed(eventId, new Date())
    return
  }

  const handler = handlerFor(envelope.eventName)
  if (!handler) {
    // Nobody is listening, and that is fine — plenty of events exist for the audit trail alone.
    await outboxRepository.markProcessed(eventId, new Date())
    return
  }

  try {
    await handler(envelope as OutboxEnvelope)
    await outboxRepository.markProcessed(eventId, new Date())
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await outboxRepository.markFailed(eventId, message)
    // Rethrown so BullMQ retries with backoff rather than counting this a success.
    throw error
  }
}

async function main(): Promise<void> {
  env()
  await connect()
  bootstrapServer()

  startWorker('notifications', async (job) => {
    if (job.name === 'outbox') await runEvent(String(job.data.eventId))
  })

  startWorker('maintenance', async (job) => {
    if (job.name === 'outbox-backstop') {
      const pending = await outboxRepository.pendingBefore(new Date(Date.now() - BACKSTOP_GRACE_MS))
      for (const event of pending) {
        await queue('notifications').add('outbox', { eventId: event.id })
      }
      if (pending.length > 0) {
        console.warn(`[worker] backstop picked up ${pending.length} event(s) the stream missed`)
      }
    }

    if (job.name === 'appointment-reminders') {
      const result = await sweepReminders()
      if (result.sent > 0) {
        console.warn(
          `[worker] reminders: ${result.sent} sent, ${result.alreadySent} already had one`,
        )
      }
    }
  })

  watcher = await watchOutbox(
    RELAY_NAME,
    async (envelope) => {
      await queue('notifications').add('outbox', { eventId: envelope.id })
    },
    (error) => {
      // Never fatal. The stream is the fast path and the sweep is the guarantee, so a broken
      // stream degrades latency rather than losing events.
      console.error('[worker] outbox stream error', error)
    },
  )

  await schedule('maintenance', 'outbox-backstop', BACKSTOP_EVERY_MS)
  await schedule('maintenance', 'appointment-reminders', REMINDER_EVERY_MS)

  console.warn('[worker] relay, backstop and reminder sweep are running')
}

async function shutdown(): Promise<void> {
  console.warn('[worker] shutting down')
  await watcher?.close().catch(() => undefined)
  await closeQueues().catch(() => undefined)
  await flushAudit().catch(() => undefined)
  await disconnect().catch(() => undefined)
  process.exit(0)
}

process.on('SIGINT', () => void shutdown())
process.on('SIGTERM', () => void shutdown())

main().catch(async (error: unknown) => {
  console.error('[worker] failed to start', error)
  await disconnect().catch(() => undefined)
  process.exit(1)
})
