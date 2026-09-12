import { assertEventPayload, type EventName, type EventPayload } from '@clinic/events'
import type { Transaction } from '../../../transaction'
import { outboxRepository } from '../infrastructure/outbox.repository'

/**
 * Recording that something happened (section 13.4).
 *
 * **Always call this inside the transaction that caused the event.** That is the entire point of
 * an outbox: the fact and the intention to react to it are one write, so "the appointment was
 * booked but no confirmation was sent" and "a confirmation went out for a booking that rolled
 * back" are both impossible. Emitting outside a transaction still works and is the right thing
 * for a change that was not itself transactional — but then the guarantee is only as good as the
 * line above it.
 *
 * The payload is validated against the catalogue before it is written. An event is a contract
 * between a module and handlers it has never heard of, and a handler cannot check a payload that
 * was already malformed when it was stored.
 */
export async function emitEvent<N extends EventName>(
  clinicId: string,
  name: N,
  payload: EventPayload<N>,
  tx?: Transaction,
  now: Date = new Date(),
): Promise<string> {
  const validated = assertEventPayload(name, payload)
  return outboxRepository.append(
    { clinicId, eventName: name, payload: validated, occurredAt: now },
    tx,
  )
}
