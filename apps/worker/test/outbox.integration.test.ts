import { describe, expect, it } from 'vitest'
import { env } from '@clinic/config'
import { OutboxEventModel } from '@clinic/db'
import { emitEvent, outboxRepository } from '@clinic/core/outbox'
import { runInTransaction } from '@clinic/core'

/**
 * The transactional outbox and its relay (section 13.4).
 *
 * The property that matters is not "events get delivered" — it is that an event and the change
 * that caused it are **one write**. Both halves of the classic failure are tested here: a
 * committed change always has its event, and a rolled-back one never does.
 */

const clinicId = () => env().CLINIC_ID

const pendingFor = (eventName: string) =>
  OutboxEventModel().countDocuments({ clinicId: clinicId(), eventName, processedAt: null })

describe('writing an event', () => {
  it('validates the payload against the catalogue before storing it', async () => {
    // An event is a contract with handlers that have never heard of the emitter, and a handler
    // cannot check a payload that was already malformed when it was written.
    await expect(
      // @ts-expect-error — deliberately the wrong shape for this event.
      emitEvent(clinicId(), 'invoice.issued', { nonsense: true }),
    ).rejects.toThrow()
  })

  it('lands with the change that caused it, and rolls back with it', async () => {
    const marker = `tx-${Date.now()}`

    // A transaction that commits: the event is there.
    await runInTransaction(async (tx) => {
      await emitEvent(clinicId(), 'invoice.issued', { invoiceId: `${marker}-kept` }, tx)
    })

    // One that does not: the event is not.
    await expect(
      runInTransaction(async (tx) => {
        await emitEvent(clinicId(), 'invoice.issued', { invoiceId: `${marker}-rolled-back` }, tx)
        throw new Error('the business rule said no')
      }),
    ).rejects.toThrow('the business rule said no')

    const written = await OutboxEventModel()
      .find({ clinicId: clinicId(), eventName: 'invoice.issued' })
      .lean()
    const ids = written.map((row) => (row.payload as { invoiceId?: string })?.invoiceId)

    expect(ids).toContain(`${marker}-kept`)
    // The half that is easy to get wrong: an email for a booking that never happened.
    expect(ids).not.toContain(`${marker}-rolled-back`)
  })
})

describe('marking an event done', () => {
  /**
   * The stream and the backstop sweep reaching the same event is the **ordinary case**, not an
   * error — which is why `markProcessed` is conditional and why the loser is told so rather than
   * silently double-handling.
   */
  it('lets exactly one of two racing relays claim it', async () => {
    const eventId = await emitEvent(clinicId(), 'ticket.created', { ticketId: newMarker() })
    const at = new Date()

    const [first, second] = await Promise.all([
      outboxRepository.markProcessed(eventId, at),
      outboxRepository.markProcessed(eventId, at),
    ])

    expect([first, second].filter(Boolean)).toHaveLength(1)
  })

  it('sets a TTL so a processed event reclaims itself', async () => {
    const eventId = await emitEvent(clinicId(), 'ticket.created', { ticketId: newMarker() })
    await outboxRepository.markProcessed(eventId, new Date())

    const doc = await OutboxEventModel().findById(eventId).lean()
    expect(doc?.processedAt).not.toBeNull()
    // Work the database does for us is work that cannot silently stop running (8.16).
    expect(doc?.expiresAt).toBeInstanceOf(Date)
    expect((doc?.expiresAt as Date).getTime()).toBeGreaterThan(Date.now())
  })

  it('counts a failure and leaves the event for the next attempt', async () => {
    const eventId = await emitEvent(clinicId(), 'ticket.created', { ticketId: newMarker() })
    await outboxRepository.markFailed(eventId, 'SMTP said no')

    const doc = await OutboxEventModel().findById(eventId).lean()
    expect(doc?.attempts).toBe(1)
    expect(doc?.lastError).toBe('SMTP said no')
    // Still pending, which is what lets the sweep find it again.
    expect(doc?.processedAt).toBeNull()
  })
})

describe('the backstop sweep', () => {
  /**
   * The stream is the fast path; this is the guarantee. A resume token older than the oplog
   * cannot resume and a stream can gap — neither costs an event, because the sweep finds
   * anything still unprocessed.
   */
  it('finds what a stream would have missed, and ignores what it has already done', async () => {
    const before = await pendingFor('stock.low')

    const missed = await emitEvent(clinicId(), 'stock.low', {
      itemId: newMarker(),
      quantityOnHand: '2.000',
    })
    const handled = await emitEvent(clinicId(), 'stock.low', {
      itemId: newMarker(),
      quantityOnHand: '1.000',
    })
    await outboxRepository.markProcessed(handled, new Date())

    expect(await pendingFor('stock.low')).toBe(before + 1)

    const pending = await outboxRepository.pendingBefore(new Date(Date.now() + 1_000))
    const ids = pending.map((event) => event.id)
    expect(ids).toContain(missed)
    expect(ids).not.toContain(handled)
  })

  it('leaves an event younger than the grace period to the stream', async () => {
    const fresh = await emitEvent(clinicId(), 'stock.low', {
      itemId: newMarker(),
      quantityOnHand: '3.000',
    })

    // Anything newer than the cut-off is almost certainly already on a queue; picking it up
    // too would only make two handlers contend for the same conditional update.
    const pending = await outboxRepository.pendingBefore(new Date(Date.now() - 30_000))
    expect(pending.map((event) => event.id)).not.toContain(fresh)
  })
})

let counter = 0
const newMarker = () => `marker-${Date.now()}-${(counter += 1)}`
