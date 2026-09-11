import { z } from 'zod'

/**
 * Domain events (section 13.4). Written to the outbox inside the business
 * transaction, relayed by a change stream. Adding a reaction means adding a
 * handler, never editing the emitter.
 */
export const EVENTS = {
  'clinic.updated': z.object({ clinicId: z.string() }),
  'user.invited': z.object({ userId: z.string(), email: z.string() }),
  'user.updated': z.object({ userId: z.string() }),
  'role.permissions_changed': z.object({ roleId: z.string() }),

  'appointment.booked': z.object({ appointmentId: z.string() }),
  'appointment.cancelled': z.object({ appointmentId: z.string(), reason: z.string().optional() }),
  'encounter.completed': z.object({ encounterId: z.string() }),
  'invoice.issued': z.object({ invoiceId: z.string() }),
  'payment.recorded': z.object({ paymentId: z.string() }),
  'stock.low': z.object({ itemId: z.string(), quantityOnHand: z.string() }),
  'ticket.created': z.object({ ticketId: z.string() }),
} as const

export type EventName = keyof typeof EVENTS
export type EventPayload<N extends EventName> = z.infer<(typeof EVENTS)[N]>

export const EVENT_NAMES = Object.keys(EVENTS) as EventName[]

/** Throws if a payload does not match its declared schema — events are contracts too. */
export function assertEventPayload<N extends EventName>(
  name: N,
  payload: unknown,
): EventPayload<N> {
  return EVENTS[name].parse(payload) as EventPayload<N>
}
